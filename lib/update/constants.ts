import path from "path";
import type { UpdatePhase } from "./types";

// The host-side updater (nova-release) and the app communicate through plain
// files inside the shared, bind-persistent `data/` directory:
//   data/update/state.json        <- written by the host updater, read here
//   data/update/check.json        <- update check cache, owned by the app
//   data/update/control/<id>.json <- update/rollback requests, app -> updater
// Using `data/` means no extra Docker mounts: the container already sees it and
// the host updater operates on the same inode under shared/data.

export const UPDATE_DIR =
  process.env.NOVA_UPDATE_DIR ?? path.join(process.cwd(), "data", "update");
export const STATE_PATH = path.join(UPDATE_DIR, "state.json");
export const CHECK_PATH = path.join(UPDATE_DIR, "check.json");
export const CONTROL_DIR = path.join(UPDATE_DIR, "control");

export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

export const BUSY_PHASES = new Set<UpdatePhase>([
  "queued",
  "checking",
  "building",
  "restarting",
  "verifying",
]);

// A busy phase older than this is treated as dead, not busy: a real update
// progresses or fails within minutes, but a killed updater leaves its last
// phase (e.g. "building") in state.json forever. Consumers that gate work on
// "an update is running" must not wait on a corpse.
export const BUSY_PHASE_STALE_MS = 30 * 60 * 1000;
