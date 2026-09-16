// Public lifecycle: pause, ensure, stop and restart a camera's recorder.
import { mkdir } from "fs/promises";
import { cameraDir, type CameraConfig } from "../config";
import { RETENTION_SWEEP_MS, SUPERVISE_MS } from "./constants";
import { cameraIngestionEnabled, ffmpegAvailable } from "./host";
import { purgeRecordingDir, sweepRetention } from "./segments";
import { spawnFfmpeg } from "./spawn";
import { pausedRef, registry } from "./store";
import { newRecorderState, respawn, superviseRecorder } from "./supervise";
import type { RecorderState } from "./types";

/**
 * Pause switch used while the host updater is building/switching a release:
 * encoding competes with the on-box build for CPU. Pausing stops every active
 * recorder, and while paused `ensureRecorder` refuses to start new ones — the
 * camera routes call it on every status/segment request, so without the gate
 * an open dashboard panel would restart the feed mid-update. Resuming only
 * clears the flag; callers restart cameras explicitly via `ensureRecorder`.
 */
export function setRecordersPaused(paused: boolean) {
  const ref = pausedRef();
  if (ref.paused === paused) {
    return;
  }
  ref.paused = paused;
  if (paused) {
    for (const id of registry().keys()) {
      stopRecorder(id);
    }
  }
}

/**
 * Ensure a recorder is running for this camera. Safe to call on every request;
 * it no-ops once the encoder is live. Returns false when recording is impossible
 * (no ffmpeg) so callers can fall back to the client-side placeholder.
 */
export async function ensureRecorder(camera: CameraConfig): Promise<boolean> {
  if (!ffmpegAvailable() || pausedRef().paused) {
    return false;
  }
  // Config-disabled camera: make sure nothing is running (incl. the test pattern)
  // and refuse to start. Called on every status/segment request, so this both
  // enforces the off state and tears down a recorder the moment the flag flips.
  if (!cameraIngestionEnabled(camera)) {
    stopRecorder(camera.id);
    return false;
  }

  const existing = registry().get(camera.id);
  // Already running — or a restart/respawn is mid-flight. The `transitioning`
  // check is essential: `respawn` nulls state.child during its stop→settle→spawn
  // window, and this route is called on EVERY HLS segment/status request. Without
  // it, one of those concurrent calls slips through and spawns a SECOND encoder
  // that then clobbers the same playlist — the "stuck on the test pattern while
  // the device is also encoding" bug.
  if (
    existing &&
    !existing.stopped &&
    (existing.child || existing.restartTimer || existing.transitioning)
  ) {
    return true;
  }

  const state: RecorderState = existing ?? newRecorderState(camera);
  state.camera = camera;
  state.stopped = false;
  // Reserve synchronously, before the first await, so a concurrent ensureRecorder
  // (or the supervisor's respawn) sees the transition at the guard above and
  // bails instead of double-spawning.
  state.transitioning = true;
  registry().set(camera.id, state);

  try {
    const dir = cameraDir(camera);
    await mkdir(dir, { recursive: true });
    await purgeRecordingDir(camera);

    if (!state.sweepTimer) {
      state.sweepTimer = setInterval(() => {
        void sweepRetention(camera);
      }, RETENTION_SWEEP_MS);
      // Don't keep the event loop alive solely for the sweep.
      state.sweepTimer.unref?.();
    }

    if (!state.superviseTimer) {
      state.superviseTimer = setInterval(() => {
        void superviseRecorder(state).catch(() => undefined);
      }, SUPERVISE_MS);
      state.superviseTimer.unref?.();
    }

    spawnFfmpeg(state);
  } finally {
    state.transitioning = false;
  }
  return true;
}

export function stopRecorder(cameraId: string) {
  const state = registry().get(cameraId);
  if (!state) {
    return;
  }
  state.stopped = true;
  state.deviceState = "stopped";
  state.statusReason = "recorder stopped";
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
  if (state.sweepTimer) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = null;
  }
  if (state.superviseTimer) {
    clearInterval(state.superviseTimer);
    state.superviseTimer = null;
  }
  const child = state.child;
  state.child = null;
  if (child) {
    child.kill("SIGTERM");
    // An ffmpeg blocked on a frameless v4l2 read ignores SIGTERM and keeps the
    // capture device open forever, which starves both the next recorder and the
    // watchdog's free-device probe. Escalate so a stop always releases the
    // device.
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 4000);
    killer.unref?.();
    child.once("exit", () => clearTimeout(killer));
  }
}

/**
 * Restart the encoder in place, race-free: stop the current one, wait for the
 * device to be released, then spawn a fresh encoder (which re-resolves the
 * source, so a returned device is picked up). The dashboard container is never
 * touched. Used by the recorder-control API and the camera re-init flow.
 */
export async function restartRecorder(camera: CameraConfig): Promise<boolean> {
  if (!ffmpegAvailable()) {
    return false;
  }
  if (!cameraIngestionEnabled(camera)) {
    stopRecorder(camera.id);
    return false;
  }
  setRecordersPaused(false);
  const existing = registry().get(camera.id);
  if (!existing || existing.stopped) {
    return ensureRecorder(camera);
  }
  existing.camera = camera;
  if (!existing.superviseTimer) {
    existing.superviseTimer = setInterval(() => {
      void superviseRecorder(existing).catch(() => undefined);
    }, SUPERVISE_MS);
    existing.superviseTimer.unref?.();
  }
  await respawn(existing);
  return true;
}
