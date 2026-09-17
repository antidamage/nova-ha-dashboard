"use client";

/**
 * The browser half of the status orb info modules: it owns the polling, and
 * subscribes to EXACTLY the sources the selected module declares. Selecting
 * "None" or the clock starts no network traffic at all.
 *
 * Facade. The body lives in orb-info/use-orb-info/
 * (specs/agent-token-footprint.md §3.3).
 *
 *   use-orb-info/types.ts            options, stack view, source shapes
 *   use-orb-info/constants.ts        poll intervals, the local change event
 *   use-orb-info/source-model.ts     dashboard/task projections, dismissal bookkeeping
 *   use-orb-info/useSourceFeeds.ts   one polling/subscription hook per source
 *   use-orb-info/useOrbInfo.ts       the hook: selection, stack, dismissal, nova-load ingest
 */

export { ORB_INFO_CHANGE_EVENT } from "./use-orb-info/constants";
export type { NovaLoadSample, OrbStackView, UseOrbInfoOptions } from "./use-orb-info/types";
export {
  applyTaskDismissal,
  dashboardSourceFrom,
  dismissalKey,
  tasksSourceFrom,
} from "./use-orb-info/source-model";
export { useOrbInfo } from "./use-orb-info/useOrbInfo";
