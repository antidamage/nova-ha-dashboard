"use client";

// Facade: the dashboard's client-side state. The body lives in ./state/.
//   client.ts            fetchDashboardStateSnapshot — the /api/state snapshot fetch
//   useDashboardState.ts the snapshot hook: poll loop, SSE, cooldown, stall reload
//   optimistic-model.ts  optimistic entity/zone updates applied before HA echoes
export { fetchDashboardStateSnapshot } from "./state/client";
export { useDashboardState } from "./state/useDashboardState";
export {
  entityActionsAffectLightPolling,
  isLightZoneAction,
  optimisticStateForEntityActions,
  optimisticStateForZoneAction,
} from "./state/optimistic-model";
