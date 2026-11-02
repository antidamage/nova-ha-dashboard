import { createReadStream, createWriteStream } from "fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { cameraDir, PLAYLIST_FILENAME, type CameraConfig } from "./config";
import {
  isRangeId,
  parseRecordingPlaylist,
  selectSegments,
  type RangeSegment,
  type RecordingSegment,
  type SavedRangeMeta,
  type SavedRangeSummary,
} from "./saved-ranges-model";
import { videoHostAuthHeaders, videoHostFileUrl } from "./video-host";

/**
 * Time ranges saved out of the DVR window, with their base video: the recording's own
 * segments joined into one MPEG-TS file, plus metadata saying where each one is.
 * specs/camera-saved-ranges.md. In a subdirectory, which the recorder's retention sweep
 * and purge do not enter, and on this host, so restarting the capture host leaves them.
 */

type ActiveSave = { id: string; done: number; total: number };

// On globalThis so hot reload cannot start a second save beside a running one.
const store = globalThis as typeof globalThis & { __novaCameraRangeSaves?: Map<string, ActiveSave> };
const activeSaves = (store.__novaCameraRangeSaves ??= new Map<string, ActiveSave>());

const FETCH_TIMEOUT_MS = 30_000;

export function savedRangesDir(camera: CameraConfig) {
  return path.join(cameraDir(camera), "saved");
}

function rangePaths(camera: CameraConfig, id: string) {
  const dir = savedRangesDir(camera);
  return { video: path.join(dir, `${id}.ts`), meta: path.join(dir, `${id}.json`) };
}

async function writeMeta(camera: CameraConfig, meta: SavedRangeMeta) {
  const { meta: metaPath } = rangePaths(camera, meta.id);
  await writeFile(/*turbopackIgnore: true*/ `${metaPath}.tmp`, JSON.stringify(meta), "utf8");
  await rename(/*turbopackIgnore: true*/ `${metaPath}.tmp`, metaPath);
}

export async function readRange(camera: CameraConfig, id: string): Promise<SavedRangeMeta | null> {
  if (!isRangeId(id)) return null;
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ rangePaths(camera, id).meta, "utf8")) as SavedRangeMeta;
  } catch {
    return null;
  }
}

export async function listRanges(camera: CameraConfig): Promise<SavedRangeSummary[]> {
  let names: string[] = [];
  try {
    names = await readdir(/*turbopackIgnore: true*/ savedRangesDir(camera));
  } catch {
    return [];
  }
  const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  const metas = await Promise.all(ids.map((id) => readRange(camera, id)));
  const active = activeSaves.get(camera.id);
  return metas
    .filter((meta): meta is SavedRangeMeta => meta !== null)
    .map(({ segments: _segments, ...summary }): SavedRangeSummary => {
      if (summary.state !== "saving") return summary;
      // Nothing is writing it, so the server restarted partway through.
      if (active?.id !== summary.id) return { ...summary, state: "failed", error: "The save was interrupted." };
      return { ...summary, progress: active.total ? active.done / active.total : 0 };
    })
    .sort((a, b) => b.startMs - a.startMs);
}

async function readRecordingPlaylist(camera: CameraConfig): Promise<string> {
  const url = await videoHostFileUrl(camera.id, PLAYLIST_FILENAME);
  if (url === null) {
    return readFile(/*turbopackIgnore: true*/ path.join(cameraDir(camera), PLAYLIST_FILENAME), "utf8");
  }
  const response = await fetch(url, { headers: videoHostAuthHeaders(), cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`playlist ${response.status}`);
  return response.text();
}

/** The segment's bytes, or null if it has rolled out of the window. */
async function openSegment(camera: CameraConfig, file: string): Promise<Readable | null> {
  const url = await videoHostFileUrl(camera.id, file);
  if (url === null) {
    const local = path.join(cameraDir(camera), file);
    try {
      await stat(/*turbopackIgnore: true*/ local);
    } catch {
      return null;
    }
    return createReadStream(/*turbopackIgnore: true*/ local);
  }
  const response = await fetch(url, { headers: videoHostAuthHeaders(), cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok || !response.body) return null;
  return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
}

/**
 * Appends one segment, returning its length. A failure reading the segment counts as
 * missing; a failure writing the file (a full disk) ends the save.
 */
async function appendSegment(camera: CameraConfig, file: string, out: NodeJS.WritableStream): Promise<number> {
  const source = await openSegment(camera, file).catch(() => null);
  if (!source) return 0;
  const body: Buffer[] = [];
  try {
    for await (const chunk of source) body.push(chunk as Buffer);
  } catch {
    return 0;
  }
  const whole = Buffer.concat(body);
  await pipeline(Readable.from([whole]), out, { end: false });
  return whole.length;
}

/** Copies the segments oldest first: that is the end the DVR loses first. */
async function copySegments(camera: CameraConfig, id: string, wanted: RecordingSegment[], active: ActiveSave) {
  const out = createWriteStream(/*turbopackIgnore: true*/ rangePaths(camera, id).video);
  const failedToOpen = new Promise<never>((_resolve, reject) => out.once("error", reject));
  const segments: RangeSegment[] = [];
  let offset = 0;
  let gap = false;
  try {
    for (const segment of wanted) {
      const length = await Promise.race([appendSegment(camera, segment.file, out), failedToOpen]);
      active.done += 1;
      if (length === 0) {
        gap = segments.length > 0;
        continue;
      }
      segments.push({ offset, length, durationSeconds: segment.durationSeconds, startsAt: segment.startsAt, ...(gap ? { gapBefore: true } : {}) });
      offset += length;
      gap = false;
    }
  } finally {
    failedToOpen.catch(() => undefined);
    await new Promise<void>((resolve) => {
      out.once("close", resolve);
      out.end();
      if (out.destroyed) resolve();
    });
  }
  return { segments, sizeBytes: offset };
}

async function runSave(camera: CameraConfig, meta: SavedRangeMeta, wanted: RecordingSegment[], active: ActiveSave) {
  try {
    const { segments, sizeBytes } = await copySegments(camera, meta.id, wanted, active);
    if (segments.length === 0) throw new Error("All of that footage has left the window.");
    const last = segments[segments.length - 1];
    await writeMeta(camera, {
      ...meta,
      state: "ready",
      segments,
      sizeBytes,
      startMs: segments[0].startsAt,
      endMs: last.startsAt + last.durationSeconds * 1000,
      durationSeconds: segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[nova-dashboard] camera range save failed", { cameraId: camera.id, rangeId: meta.id, message });
    await writeMeta(camera, { ...meta, state: "failed", error: message }).catch(() => undefined);
  } finally {
    activeSaves.delete(camera.id);
  }
}

export class RangeSaveError extends Error {}

/** Starts saving and returns at once. The save goes on in the background. */
export async function startSave(camera: CameraConfig, startMs: number, endMs: number): Promise<SavedRangeSummary> {
  if (activeSaves.has(camera.id)) throw new RangeSaveError("Another range is still saving.");
  const wanted = selectSegments(parseRecordingPlaylist(await readRecordingPlaylist(camera)), startMs, endMs);
  if (wanted.length === 0) throw new RangeSaveError("None of that footage is in the window any more.");
  // The read above yields, so another request may have got here first.
  if (activeSaves.has(camera.id)) throw new RangeSaveError("Another range is still saving.");

  const id = `range_${Date.now()}`;
  const active: ActiveSave = { id, done: 0, total: wanted.length };
  activeSaves.set(camera.id, active);
  const meta: SavedRangeMeta = {
    id,
    createdAt: new Date().toISOString(),
    startMs,
    endMs,
    durationSeconds: Math.round((endMs - startMs) / 1000),
    sizeBytes: 0,
    state: "saving",
    segments: [],
  };
  try {
    await mkdir(/*turbopackIgnore: true*/ savedRangesDir(camera), { recursive: true });
    await writeMeta(camera, meta);
  } catch (error) {
    activeSaves.delete(camera.id);
    throw error;
  }
  void runSave(camera, meta, wanted, active);
  const { segments: _segments, ...summary } = meta;
  return { ...summary, progress: 0 };
}

/** False if it is unknown, or still being written. */
export async function deleteRange(camera: CameraConfig, id: string): Promise<boolean> {
  if (!isRangeId(id) || activeSaves.get(camera.id)?.id === id) return false;
  if ((await readRange(camera, id)) === null) return false;
  const { video, meta } = rangePaths(camera, id);
  await unlink(/*turbopackIgnore: true*/ video).catch(() => undefined);
  await unlink(/*turbopackIgnore: true*/ meta);
  return true;
}

export function rangeVideoPath(camera: CameraConfig, id: string) {
  return rangePaths(camera, id).video;
}
