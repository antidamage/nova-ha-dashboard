// The self-heal supervisor, the race-free stop/respawn, and a fresh state.
import type { CameraConfig } from "../config";
import { FRESH_SEGMENT_MS, SELF_HEAL_MIN_INTERVAL_MS, WARMUP_MS } from "./constants";
import { deviceAvailable, resolveSource, withDashboardProcessing } from "./host";
import { newestSegmentMs } from "./segments";
import { spawnFfmpeg } from "./spawn";
import { pausedRef } from "./store";
import type { RecorderState } from "./types";

/**
 * Periodic self-heal. Runs while the recorder is active (not paused/stopped)
 * and, without ever touching the dashboard container:
 *   - clears a stale lastError once the current encoder is confirmed healthy
 *     (fresh segments) — otherwise a historical blip keeps reading as unhealthy;
 *   - re-resolves the source: if we're on the synthetic clock but the real
 *     device has since reappeared, respawn on the device (this is exactly the
 *     "device replugged but feed still shows the test pattern" case);
 *   - detects a burst-then-stall device (encoder alive on the device but no new
 *     segment for STALL_MS) and respawns it, counting consecutive stalls so the
 *     status surface can say the device is wedged.
 */
export async function superviseRecorder(state: RecorderState) {
  if (state.stopped || pausedRef().paused || state.transitioning) {
    return;
  }
  const now = Date.now();
  const newest = await newestSegmentMs(state.camera);
  const segFresh = newest !== null && now - newest < FRESH_SEGMENT_MS;
  const deviceHere = deviceAvailable(withDashboardProcessing(state.camera));

  // Confirmed healthy: fresh segments from the current generation.
  //
  // The synthetic clock is a special case: it is ALWAYS "healthy" (testsrc2
  // never fails), so if we treated a fresh demo-clock as done we would latch
  // onto the placeholder forever and never notice the real device sitting right
  // there — the "reset only ever shows the test stream" bug. So a healthy demo
  // clock only counts as done while the device is genuinely unavailable; when
  // the device is present we fall through to the demo->device switch below and
  // go live.
  if (state.child && segFresh && (state.source === "device" || !deviceHere)) {
    state.lastError = null;
    state.consecutiveStalls = 0;
    state.lastHealthyAt = now;
    state.deviceState = state.source === "device" ? "streaming" : "demo-fallback";
    state.statusReason = state.source === "device" ? "streaming the capture device" : "running the synthetic clock";
    return;
  }

  // Don't self-heal during warmup or too frequently.
  const warming = now - state.startedAt < WARMUP_MS;
  const cooled = now - state.lastSelfHealAt > SELF_HEAL_MIN_INTERVAL_MS;

  // On the synthetic clock while the real device is now available -> switch.
  if (state.source !== "device" && deviceHere && cooled) {
    state.lastSelfHealAt = now;
    state.statusReason = "device reappeared — switching off the synthetic clock";
    await respawn(state);
    return;
  }

  // Encoder alive on the device but no fresh segments past warmup -> wedged.
  if (state.child && state.source === "device" && !segFresh && !warming && cooled) {
    state.lastSelfHealAt = now;
    state.lastStallAt = now;
    state.consecutiveStalls += 1;
    state.deviceState = "device-stalled";
    state.statusReason = `no new segment for ${Math.round((now - (newest ?? state.startedAt)) / 1000)}s (device wedged); restarting encoder`;
    await respawn(state);
  }
}

/** Stop the current child (SIGTERM -> SIGKILL) and resolve once it has exited,
 * so the capture device is actually released before the next spawn. */
export function stopChild(state: RecorderState): Promise<void> {
  const child = state.child;
  state.child = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve();
    };
    // Frameless-v4l2-read ffmpeg ignores SIGTERM; escalate to SIGKILL, then a
    // hard resolve so a stuck child can never wedge a restart forever.
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      setTimeout(finish, 1500);
    }, 4000);
    killer.unref?.();
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

/** Race-free restart of the current recorder's encoder: fully stop (await the
 * device release) then spawn a fresh one. Serialized via `transitioning` so two
 * callers can't spawn overlapping encoders that fight over the device (the
 * source of the intermittent "Device or resource busy" / code-240 errors). */
export async function respawn(state: RecorderState): Promise<void> {
  if (state.transitioning) {
    return;
  }
  state.transitioning = true;
  try {
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }
    await stopChild(state);
    // Small settle: the kernel can hold the v4l2 device briefly after ffmpeg exits.
    await new Promise((r) => setTimeout(r, 400));
    if (!state.stopped && !pausedRef().paused) {
      state.restarts = 0;
      spawnFfmpeg(state);
    }
  } finally {
    state.transitioning = false;
  }
}

export function newRecorderState(camera: CameraConfig): RecorderState {
  return {
    camera,
    source: resolveSource(camera),
    child: null,
    startedAt: 0,
    restarts: 0,
    restartTimer: null,
    sweepTimer: null,
    superviseTimer: null,
    stopped: false,
    lastError: null,
    deviceState: "stopped",
    statusReason: "not started",
    lastHealthyAt: null,
    lastStallAt: null,
    consecutiveStalls: 0,
    lastSelfHealAt: 0,
    transitioning: false,
  };
}
