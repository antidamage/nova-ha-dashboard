/**
 * iCloud calendar and reminder mirror (read-only) — facade. The body lives in
 * lib/icloud-sync/; this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   icloud-sync/types.ts          result, status and ical.js shapes
 *   icloud-sync/constants.ts      reminder defaults, VTODO filter
 *   icloud-sync/store.ts          SOLE owner of the process-wide sync state
 *   icloud-sync/time-model.ts     household zone, wall-clock to UTC, recurrence
 *   icloud-sync/ical-model.ts     VEVENT/VTODO to mirror tasks
 *   icloud-sync/mirror-model.ts   calendar selection, mirror keys, local linking
 *   icloud-sync/sync.ts           the CalDAV sync pass
 */
export type { IcloudSyncResult, IcloudSyncStatus } from "./icloud-sync/types";
export { getIcloudSyncStatus } from "./icloud-sync/store";
export { syncIcloud } from "./icloud-sync/sync";
