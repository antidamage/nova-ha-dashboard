// Host and device probes: the ffmpeg binary and its launch prefix, device
// presence, the config ingestion switch, the demo-clock switch, source
// resolution, and the orphaned-encoder reaper.
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { readDashboardConfigSync } from "../../dashboard-config";
import { cameraDir, PLAYLIST_FILENAME, type CameraConfig, type CameraSource } from "../config";

export const FFMPEG_BIN = process.env.NOVA_FFMPEG_PATH?.trim() || "ffmpeg";
// The encoder is a background job that must never starve the dashboard server or
// the on-box kiosk browser — when it did, the kiosk's health check stalled and
// falsely flashed the "Reconnecting to Nova" offline overlay. On Linux we launch
// ffmpeg at a low CPU priority so the scheduler always preempts it in favour of
// the UI. `nice`/`chrt` exec ffmpeg, so the spawned child is still ffmpeg itself
// (same pid, signals and stderr intact). Tunable via NOVA_FFMPEG_NICE (0 = off).
export const FFMPEG_NICE = normalizeFfmpegNice(process.env.NOVA_FFMPEG_NICE);

export function normalizeFfmpegNice(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 19; // default: lowest-priority background encode
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(19, Math.round(value))) : 19;
}

/**
 * Command + leading args used to launch the encoder. On Linux we prefix `nice`
 * (coreutils, always present) so the encode yields to the dashboard/browser
 * under contention. Off-Linux (dev) or when disabled we run ffmpeg directly.
 */
export function ffmpegLaunchPrefix(): string[] {
  if (process.platform === "linux" && FFMPEG_NICE > 0) {
    return ["nice", "-n", String(FFMPEG_NICE), FFMPEG_BIN];
  }
  return [FFMPEG_BIN];
}

export function ffmpegAvailable() {
  // `spawn` would throw asynchronously; a cheap existence check keeps the demo
  // build and ffmpeg-less hosts from crash-looping. Absolute paths are checked
  // directly, bare command names are assumed present on PATH.
  if (FFMPEG_BIN.includes("/") || FFMPEG_BIN.includes("\\")) {
    return existsSync(FFMPEG_BIN);
  }
  return true;
}

export function deviceAvailable(camera: CameraConfig) {
  return Boolean(camera.devicePath) && existsSync(camera.devicePath);
}

/**
 * Config master-switch for camera ingestion. When the Outside camera is disabled
 * in the config panel, NO ffmpeg runs — not the real capture, not the demo-clock
 * test pattern — so the box sheds that CPU. Only the Outside camera is
 * config-driven today; anything else defaults on. Fails safe (on) if the config
 * can't be read.
 */
export function cameraIngestionEnabled(camera: CameraConfig): boolean {
  if (camera.id !== "outside") {
    return true;
  }
  try {
    return readDashboardConfigSync().dashboard.camera.outside.ingestionEnabled !== false;
  } catch {
    return true;
  }
}

/**
 * Master switch for the synthetic "demo clock" fallback. When the capture device
 * is absent, the recorder USED to always fabricate a testsrc/clock test pattern
 * so the panel showed something. On a real, owner-facing host that just reads as
 * a fake "test stream" sitting where the camera should be — misleading when the
 * grabber is simply unplugged. So the fallback is now OFF by default: an absent
 * device shows a plain "No signal" state instead. It stays available for the
 * static demo build and for dev boxes that want a placeholder, via
 * `NOVA_CAMERA_DEMO_CLOCK` (1/true/on) or `NEXT_PUBLIC_NOVA_DEMO_MODE=true`.
 */
export function demoClockFallbackEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true") {
    return true;
  }
  const flag = process.env.NOVA_CAMERA_DEMO_CLOCK?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "on";
}

export function resolveSource(camera: CameraConfig): CameraSource {
  return deviceAvailable(camera) ? "device" : "demo-clock";
}

/**
 * Linux-only, dependency-free reap of orphaned encoders. Scans /proc for any
 * ffmpeg still writing THIS camera's playlist and SIGKILLs it. We can only see
 * and signal processes in our own PID namespace — which is exactly where the
 * recorder's ffmpeg children live — so it reliably reaches a stray that a lost
 * reference left running. No-op off Linux (dev) and when nothing matches.
 *
 * This is the safety net for the "two encoders, one playlist" failure: if a
 * settle-gap double-spawn (or any generation change) ever orphans an encoder,
 * that orphan is otherwise never killed and interleaves its frames — e.g. a
 * demo-clock encoder clobbering the real device feed with the test pattern.
 */
export function reapStrayEncoders(camera: CameraConfig): void {
  if (process.platform !== "linux") {
    return;
  }
  const needle = path.join(cameraDir(camera), PLAYLIST_FILENAME);
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) {
      continue;
    }
    const numeric = Number(pid);
    if (numeric === process.pid) {
      continue;
    }
    let cmdline: string;
    try {
      // /proc/<pid>/cmdline is NUL-separated argv; the playlist path is its own
      // argument, so a plain substring match on it is exact enough.
      cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue; // process vanished or unreadable
    }
    if (cmdline.includes("ffmpeg") && cmdline.includes(needle)) {
      try {
        process.kill(numeric, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

export function withDashboardProcessing(camera: CameraConfig): CameraConfig {
  try {
    const processing = readDashboardConfigSync().dashboard.camera.outside.processing;
    return { ...camera, ...processing };
  } catch {
    return camera;
  }
}
