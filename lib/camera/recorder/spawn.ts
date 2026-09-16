// Spawning one encoder generation, classifying its exit, and the backoff
// restart that follows.
import { spawn } from "child_process";
import { RESTART_MAX_DELAY_MS, RESTART_MIN_DELAY_MS } from "./constants";
import { ffmpegArgs } from "./ffmpeg-args";
import { demoClockFallbackEnabled, ffmpegLaunchPrefix, reapStrayEncoders, resolveSource, withDashboardProcessing } from "./host";
import type { CameraDeviceState, RecorderState } from "./types";

export function backoffDelay(restarts: number) {
  return Math.min(RESTART_MIN_DELAY_MS * 2 ** Math.min(restarts, 5), RESTART_MAX_DELAY_MS);
}

export function classifyExit(stderrTail: string): CameraDeviceState {
  const err = stderrTail.toLowerCase();
  if (err.includes("resource busy") || err.includes("device busy")) {
    return "device-busy";
  }
  if (err.includes("no such file") || err.includes("no such device") || err.includes("cannot open")) {
    return "device-absent";
  }
  return "device-error";
}

export function spawnFfmpeg(state: RecorderState) {
  const camera = withDashboardProcessing(state.camera);
  // Exactly one encoder per camera. spawnFfmpeg is the only place an encoder is
  // created, so enforcing the invariant here covers every path (cold start,
  // scheduled restart, respawn/reset). Kill the currently-tracked child, then —
  // belt and braces — reap any orphan from a previous generation still writing
  // this playlist, so a (re)start never has to compete with a stale encoder.
  if (state.child) {
    try {
      state.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    state.child = null;
  }
  reapStrayEncoders(camera);
  const source = resolveSource(camera);
  state.source = source;

  // Capture device absent and the synthetic-clock fallback is disabled (the
  // default on a real host): don't fabricate a test pattern. Any running clock
  // was just killed + reaped above, so we go idle — no child, no restart timer —
  // and the status surface reports "device absent" so the panel shows "No
  // signal". We stay armed: the supervisor (and ensureRecorder on the next poll)
  // respawns the instant the device is plugged back in.
  if (source === "demo-clock" && !demoClockFallbackEnabled()) {
    state.child = null;
    state.deviceState = "device-absent";
    state.statusReason = "capture device not present; feed offline (synthetic clock disabled)";
    return;
  }

  const [launchBin, ...launchPrefixArgs] = ffmpegLaunchPrefix();
  const child = spawn(launchBin, [...launchPrefixArgs, ...ffmpegArgs(camera, source)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  state.child = child;
  state.startedAt = Date.now();
  // Fresh generation: clear any error carried over from a prior ffmpeg so a
  // successful restart immediately reports healthy again.
  state.lastError = null;
  state.deviceState = source === "device" ? "starting" : "demo-fallback";
  state.statusReason =
    source === "device" ? "encoder starting on the capture device" : "running the synthetic clock (device not usable)";

  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });

  child.on("error", (error) => {
    if (state.child === child) {
      state.child = null;
    }
    if (!state.stopped) {
      state.lastError = error.message;
      state.deviceState = "device-error";
      state.statusReason = `failed to launch encoder: ${error.message}`;
      scheduleRestart(state);
    }
  });

  child.on("exit", (code, signal) => {
    // Ignore the exit of a child we've already replaced (avoids a late exit from
    // an old generation clobbering the current one's state).
    if (state.child === child) {
      state.child = null;
    }
    // A deliberate stop (stopRecorder/pause) SIGTERM/SIGKILLs ffmpeg, which
    // exits 255 — that is not a fault. Recording it as lastError made the
    // camera watchdog read a freshly-restarted, healthy recorder as unhealthy
    // ("ffmpeg error") and loop on recovery forever.
    if (code && code !== 0 && !state.stopped) {
      const line = stderrTail.trim().split("\n").pop() ?? "";
      state.lastError = `ffmpeg exited (code ${code}${signal ? `, ${signal}` : ""}): ${line}`;
      // Only downgrade the classified state if this exit belongs to the live
      // generation; a busy/absent classification tells the UI + watchdog why.
      if (source === "device") {
        state.deviceState = classifyExit(stderrTail);
        state.statusReason = state.lastError;
      }
    }
    if (!state.stopped) {
      scheduleRestart(state);
    }
  });
}

export function scheduleRestart(state: RecorderState) {
  if (state.stopped || state.restartTimer) {
    return;
  }
  const delay = backoffDelay(state.restarts);
  state.restarts += 1;
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (!state.stopped) {
      spawnFfmpeg(state);
    }
  }, delay);
}
