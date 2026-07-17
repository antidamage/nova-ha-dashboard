import { updaterBusy } from "../update";
import { CAMERAS } from "./config";
import { ensureRecorder, recordersPaused, setRecordersPaused } from "./recorder";

/**
 * Pauses the camera DVR while the host updater (nova-release) is mid-run and
 * resumes it afterwards. The encoder and the on-box release build compete for
 * the same cores, so the feed shuts down for the build/switch window and comes
 * back once the updater reports a terminal phase. Keyed off the shared
 * data/update/state.json, so it covers cron auto-updates, manual applies and
 * migrations alike. updaterBusy() treats a phase stuck for >30 minutes as a
 * dead updater, so a killed build can never silence the cameras permanently.
 */

const POLL_MS = 15_000;
const STARTED_KEY = "__novaCameraUpdatePauseWatcher__";

export async function runCameraUpdatePauseTick() {
  const busy = await updaterBusy();
  if (busy && !recordersPaused()) {
    console.log("[camera] pausing recorders while the updater runs");
    setRecordersPaused(true);
    return;
  }
  if (!busy && recordersPaused()) {
    console.log("[camera] updater finished; resuming recorders");
    setRecordersPaused(false);
    for (const camera of CAMERAS) {
      await ensureRecorder(camera);
    }
  }
}

export function startCameraUpdatePauseWatcher() {
  const globalRef = globalThis as unknown as Record<string, boolean | undefined>;
  if (globalRef[STARTED_KEY]) {
    return;
  }
  globalRef[STARTED_KEY] = true;

  const tick = () =>
    runCameraUpdatePauseTick().catch((error) => {
      console.error("[camera] update pause check failed", error);
    });
  const interval = setInterval(() => void tick(), POLL_MS);
  interval.unref?.();
  void tick();
}
