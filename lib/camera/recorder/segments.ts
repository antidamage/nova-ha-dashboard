// On-disk segments: purge, retention sweep, newest-segment probe, and serving
// a playlist or segment to the HTTP route.
import { readdir, readFile, stat, unlink } from "fs/promises";
import path from "path";
import { cameraDir, PLAYLIST_FILENAME, retentionSeconds, type CameraConfig } from "../config";

/** Delete segments + the playlist so a restart never appends onto stale media. */
export async function purgeRecordingDir(camera: CameraConfig) {
  const dir = cameraDir(camera);
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.allSettled(
    entries
      .filter((name) => name.endsWith(".ts") || name === PLAYLIST_FILENAME || name.endsWith(".m3u8.tmp"))
      .map((name) => unlink(path.join(dir, name))),
  );
}

/**
 * Defence-in-depth retention: ffmpeg already deletes rolled-off segments, but a
 * sweep removes anything ffmpeg orphaned (e.g. after an unclean exit) so the
 * "never older than two hours" guarantee holds even across crashes.
 */
export async function sweepRetention(camera: CameraConfig) {
  const dir = cameraDir(camera);
  const maxAgeMs = (retentionSeconds(camera) + camera.segmentSeconds * 4) * 1000;
  const cutoff = Date.now() - maxAgeMs;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.allSettled(
    entries
      .filter((name) => name.endsWith(".ts"))
      .map(async (name) => {
        const filePath = path.join(dir, name);
        try {
          const info = await stat(filePath);
          if (info.mtimeMs < cutoff) {
            await unlink(filePath);
          }
        } catch {
          /* file already gone */
        }
      }),
  );
}

/** Newest .ts segment mtime (ms) for this camera, or null if none. */
export async function newestSegmentMs(camera: CameraConfig): Promise<number | null> {
  try {
    const dir = cameraDir(camera);
    const entries = (await readdir(dir)).filter((name) => name.endsWith(".ts"));
    const mtimes = await Promise.all(
      entries.map(async (name) => {
        try {
          return (await stat(path.join(dir, name))).mtimeMs;
        } catch {
          return null;
        }
      }),
    );
    let newest: number | null = null;
    for (const m of mtimes) {
      if (m !== null) {
        newest = newest === null ? m : Math.max(newest, m);
      }
    }
    return newest;
  } catch {
    return null;
  }
}

/** True only for camera files the HTTP route may serve. */
export function isRecordingFilename(file: string): boolean {
  return file === PLAYLIST_FILENAME || /^seg_(?:[a-z0-9]+_)?\d{6}\.ts$/.test(file);
}

/** Read a playlist or segment, enforcing the retention window for segments. */
export async function readRecordingFile(
  camera: CameraConfig,
  file: string,
): Promise<{ data: Buffer; contentType: string } | { error: "not-found" | "expired" | "invalid" }> {
  // Path-traversal guard: only a bare playlist or segment basename is valid.
  // Current segments include a base-36 encoder-generation id so immutable URLs
  // never collide across restarts; accept the older unscoped form for retained
  // DVR windows created before generation ids were introduced.
  const isPlaylist = file === PLAYLIST_FILENAME;
  const isSegment = !isPlaylist && isRecordingFilename(file);
  if (!isRecordingFilename(file)) {
    return { error: "invalid" };
  }

  const filePath = path.join(cameraDir(camera), file);
  try {
    if (isSegment) {
      const info = await stat(filePath);
      const maxAgeMs = (retentionSeconds(camera) + camera.segmentSeconds * 4) * 1000;
      if (Date.now() - info.mtimeMs > maxAgeMs) {
        return { error: "expired" };
      }
    }
    const data = await readFile(filePath);
    return {
      data,
      contentType: isPlaylist ? "application/vnd.apple.mpegurl" : "video/mp2t",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: "not-found" };
    }
    throw error;
  }
}
