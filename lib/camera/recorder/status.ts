// The status surface: segment window, liveness and the classified device state.
import { readdir, stat } from "fs/promises";
import path from "path";
import { cameraDir, retentionSeconds, type CameraConfig } from "../config";
import { FRESH_SEGMENT_MS } from "./constants";
import { deviceAvailable, ffmpegAvailable, resolveSource } from "./host";
import { pausedRef, registry } from "./store";
import type { CameraDeviceState, RecorderStatus } from "./types";

export async function recorderStatus(camera: CameraConfig): Promise<RecorderStatus> {
  const state = registry().get(camera.id);
  const dir = cameraDir(camera);
  let oldest: number | null = null;
  let newest: number | null = null;
  try {
    const entries = (await readdir(dir)).filter((name) => name.endsWith(".ts"));
    // Stat in one parallel batch. A full DVR window is ~3600 segments and the
    // serial per-file `await` this replaces cost one event-loop turn EACH — on
    // a busy box that made this "lightweight" status route take 20s+, which
    // the camera watchdog read as "dashboard unreachable"/"recovery failed"
    // and answered with escalating restarts.
    const mtimes = await Promise.all(
      entries.map(async (name) => {
        try {
          return (await stat(path.join(dir, name))).mtimeMs;
        } catch {
          return null;
        }
      }),
    );
    for (const mtime of mtimes) {
      if (mtime === null) {
        continue;
      }
      oldest = oldest === null ? mtime : Math.min(oldest, mtime);
      newest = newest === null ? mtime : Math.max(newest, mtime);
    }
  } catch {
    /* no recordings yet */
  }

  const paused = pausedRef().paused;
  const source = state?.source ?? resolveSource(camera);
  const recording = Boolean(state && !state.stopped && (state.child || state.restartTimer));
  const deviceConnected = deviceAvailable(camera);
  const ageMs = newest !== null ? Date.now() - newest : null;
  const healthy = ageMs !== null && ageMs < FRESH_SEGMENT_MS && source === "device";
  const newestSegmentAgeSeconds = ageMs !== null ? Math.round(ageMs / 1000) : null;

  // Derive the classified deviceState/statusReason live from ground truth
  // (segment freshness + source + child liveness), falling back to whatever the
  // encoder lifecycle recorded. Segment freshness is authoritative: a device
  // that is genuinely streaming reads healthy even if a prior blip left an error.
  let deviceState: CameraDeviceState = state?.deviceState ?? (recording ? "starting" : "stopped");
  let statusReason = state?.statusReason ?? "not started";
  if (paused) {
    deviceState = "paused";
    statusReason = "recorder paused (update or device re-initialisation in progress)";
  } else if (!ffmpegAvailable()) {
    deviceState = "unavailable";
    statusReason = "no ffmpeg on this host";
  } else if (!recording) {
    // Two ways to be "not recording": genuinely stopped (ingestion disabled), or
    // armed-but-idle because the device is absent and the synthetic-clock
    // fallback is off. Distinguish them so the panel/config UI show "No signal"
    // for the latter instead of an ambiguous "recorder not running".
    if (state && !state.stopped && !deviceConnected) {
      deviceState = "device-absent";
      statusReason = "capture device not present (unplugged or not enumerated); feed offline";
    } else {
      deviceState = "stopped";
      statusReason = "recorder not running";
    }
  } else if (healthy) {
    deviceState = "streaming";
    statusReason = "streaming the capture device";
  } else if (source !== "device") {
    deviceState = deviceConnected ? "starting" : "device-absent";
    statusReason = deviceConnected
      ? "device present — switching off the synthetic clock"
      : "capture device not present (unplugged or not enumerated); showing the synthetic clock";
  } else if (!deviceConnected) {
    deviceState = "device-absent";
    statusReason = "capture device path disappeared (unplugged or USB dropped)";
  }
  // else keep the lifecycle-recorded state (device-busy / device-stalled /
  // device-error / starting), which carries the precise reason.

  return {
    id: camera.id,
    name: camera.name,
    source,
    recording,
    ffmpegAvailable: ffmpegAvailable(),
    deviceConnected,
    retentionSeconds: retentionSeconds(camera),
    segmentSeconds: camera.segmentSeconds,
    oldestSegment: oldest !== null ? new Date(oldest).toISOString() : null,
    newestSegment: newest !== null ? new Date(newest).toISOString() : null,
    lastError: state?.lastError ?? null,
    deviceState,
    statusReason,
    healthy,
    newestSegmentAgeSeconds,
    consecutiveStalls: state?.consecutiveStalls ?? 0,
    paused,
  };
}
