import { createReadStream, createWriteStream, existsSync } from "fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { cameraDir, PLAYLIST_FILENAME, type CameraConfig } from "./config";

/**
 * On-demand "snapshots" of the rolling DVR window. A snapshot freezes the last
 * ~two hours of footage that is currently in the live playlist so it survives
 * past the point where the recorder rolls those segments off disk.
 *
 * Storage model: each snapshot is a single self-contained MPEG-TS file plus a
 * sidecar JSON meta, kept in a `snapshots/` subdirectory of the camera's data
 * dir. MPEG-TS is designed to concatenate, so appending the in-window segments
 * in playlist order yields one file that plays start-to-finish in any player and
 * downloads in one browser request. Living in a subdirectory keeps snapshots
 * clear of the recorder's retention machinery — both `sweepRetention` and
 * `purgeRecordingDir` are non-recursive and only ever touch `*.ts` in the dir
 * ROOT, never inside `snapshots/`.
 *
 * We keep a fixed, small number of snapshots (round-robin): after each capture
 * the oldest are deleted so only the newest MAX_SNAPSHOTS remain. Each capture is
 * hours of 1080p, so an unbounded pile would exhaust the disk.
 */

export const MAX_SNAPSHOTS = 3;

export type SnapshotMeta = {
  /** Sortable id: `snap_<epochMs>`. Also the download route param. */
  id: string;
  /** ISO wall-clock of when the capture was taken. */
  createdAt: string;
  /** Footage length in seconds (summed from the playlist EXTINF durations). */
  durationSeconds: number;
  /** Size of the concatenated .ts on disk. */
  sizeBytes: number;
  /** Number of segments that made it into the file. */
  segmentCount: number;
};

const SNAP_ID_RE = /^snap_\d+$/;

export function snapshotsDir(camera: CameraConfig) {
  return path.join(cameraDir(camera), "snapshots");
}

function snapshotPaths(camera: CameraConfig, id: string) {
  const dir = snapshotsDir(camera);
  return { ts: path.join(dir, `${id}.ts`), meta: path.join(dir, `${id}.json`) };
}

/**
 * Parse the live playlist into the ordered list of in-window segment filenames
 * plus their total duration. We read the segment order from the playlist (rather
 * than sorting the directory) so a snapshot is exactly what the DVR window can
 * currently scrub — no rolled-off or partially-written segments.
 */
async function orderedSegments(camera: CameraConfig): Promise<{ files: string[]; duration: number }> {
  const playlistPath = path.join(cameraDir(camera), PLAYLIST_FILENAME);
  const playlist = await readFile(playlistPath, "utf8");
  const files: string[] = [];
  let duration = 0;
  let pendingDuration = 0;
  for (const rawLine of playlist.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#EXTINF:")) {
      const match = /#EXTINF:([\d.]+)/.exec(line);
      pendingDuration = match ? Number.parseFloat(match[1]) : 0;
    } else if (line && !line.startsWith("#")) {
      // A media line — segments are written as bare `seg_NNNNNN.ts` basenames.
      if (/^seg_\d{6}\.ts$/.test(line)) {
        files.push(line);
        duration += pendingDuration;
      }
      pendingDuration = 0;
    }
  }
  return { files, duration };
}

/** Append one file onto an open write stream, resolving even if it vanished
 * mid-capture (the recorder can roll a segment off between listing and copy). */
function appendSegment(source: string, out: NodeJS.WritableStream): Promise<boolean> {
  if (!existsSync(source)) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const rs = createReadStream(source);
    rs.on("error", () => resolve(false));
    rs.on("end", () => resolve(true));
    rs.pipe(out, { end: false });
  });
}

/** Delete all but the newest MAX_SNAPSHOTS captures (round-robin retention). */
async function enforceRoundRobin(camera: CameraConfig) {
  const snapshots = await listSnapshots(camera);
  const stale = snapshots.slice(MAX_SNAPSHOTS);
  await Promise.allSettled(
    stale.flatMap((snapshot) => {
      const { ts, meta } = snapshotPaths(camera, snapshot.id);
      return [unlink(ts).catch(() => undefined), unlink(meta).catch(() => undefined)];
    }),
  );
}

/**
 * List stored snapshots, newest first. A snapshot is any `snap_*.ts` on disk; its
 * meta comes from the sidecar JSON, with a best-effort fallback (id-derived time +
 * on-disk size) if the sidecar is missing so a capture never becomes invisible.
 */
export async function listSnapshots(camera: CameraConfig): Promise<SnapshotMeta[]> {
  const dir = snapshotsDir(camera);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const ids = entries
    .filter((name) => name.endsWith(".ts") && SNAP_ID_RE.test(name.slice(0, -3)))
    .map((name) => name.slice(0, -3));

  const metas = await Promise.all(
    ids.map(async (id): Promise<SnapshotMeta | null> => {
      const { ts, meta } = snapshotPaths(camera, id);
      let size = 0;
      try {
        size = (await stat(ts)).size;
      } catch {
        return null; // .ts gone — not a real snapshot
      }
      try {
        const parsed = JSON.parse(await readFile(meta, "utf8")) as Partial<SnapshotMeta>;
        return {
          id,
          createdAt: parsed.createdAt ?? new Date(idEpoch(id)).toISOString(),
          durationSeconds: parsed.durationSeconds ?? 0,
          sizeBytes: size,
          segmentCount: parsed.segmentCount ?? 0,
        };
      } catch {
        return {
          id,
          createdAt: new Date(idEpoch(id)).toISOString(),
          durationSeconds: 0,
          sizeBytes: size,
          segmentCount: 0,
        };
      }
    }),
  );

  return metas
    .filter((meta): meta is SnapshotMeta => meta !== null)
    .sort((a, b) => idEpoch(b.id) - idEpoch(a.id));
}

function idEpoch(id: string): number {
  const value = Number.parseInt(id.replace("snap_", ""), 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Capture the current DVR window to a new snapshot. Concatenates the in-window
 * segments (streamed, never buffered whole) into one .ts, writes the meta, then
 * enforces the round-robin. Throws `no-footage` when the window is empty.
 */
export async function createSnapshot(camera: CameraConfig): Promise<SnapshotMeta> {
  const { files, duration } = await orderedSegments(camera);
  if (files.length === 0) {
    throw new Error("no-footage");
  }

  const dir = snapshotsDir(camera);
  await mkdir(dir, { recursive: true });

  const id = `snap_${Date.now()}`;
  const { ts: outPath, meta: metaPath } = snapshotPaths(camera, id);
  const segmentDir = cameraDir(camera);

  const out = createWriteStream(outPath);
  let segmentCount = 0;
  try {
    for (const file of files) {
      const copied = await appendSegment(path.join(segmentDir, file), out);
      if (copied) {
        segmentCount += 1;
      }
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }

  if (segmentCount === 0) {
    await unlink(outPath).catch(() => undefined);
    throw new Error("no-footage");
  }

  const sizeBytes = (await stat(outPath)).size;
  const meta: SnapshotMeta = {
    id,
    createdAt: new Date().toISOString(),
    durationSeconds: Math.round(duration),
    sizeBytes,
    segmentCount,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
  await enforceRoundRobin(camera);
  return meta;
}

/**
 * Resolve a snapshot for download: validates the id, confirms the file exists and
 * returns its path, size and a human-friendly download filename. Returns null for
 * an unknown/invalid id (the route answers 404).
 */
export async function resolveSnapshot(
  camera: CameraConfig,
  id: string,
): Promise<{ path: string; sizeBytes: number; downloadName: string } | null> {
  if (!SNAP_ID_RE.test(id)) {
    return null;
  }
  const { ts } = snapshotPaths(camera, id);
  let sizeBytes: number;
  try {
    sizeBytes = (await stat(ts)).size;
  } catch {
    return null;
  }
  const stamp = new Date(idEpoch(id))
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
  return { path: ts, sizeBytes, downloadName: `${camera.id}-${stamp}.ts` };
}
