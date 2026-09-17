/**
 * In-app updater — facade. The body lives in lib/update/; this file keeps the
 * import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   update/types.ts          updater state, check, control request, status
 *   update/constants.ts      update directory layout, check timeout, busy phases
 *   update/status-model.ts   busy-phase staleness, sha normalisation
 *   update/store.ts          SOLE file owner: state/check reads, control requests
 *   update/github-check.ts   GitHub head-commit check
 *   update/status.ts         auto-update resolution, the status the UI reads
 */
export type {
  UpdateCheck,
  UpdateControlAction,
  UpdateControlRequest,
  UpdatePhase,
  UpdaterState,
  UpdateStatus,
} from "./update/types";
export { definedSha, isUpdaterBusyState } from "./update/status-model";
export {
  readUpdateCheck,
  readUpdaterState,
  requestRollback,
  requestUpdate,
  updaterBusy,
} from "./update/store";
export { checkGitHubForUpdate } from "./update/github-check";
export { getUpdateStatus, resolveAutoUpdate } from "./update/status";
