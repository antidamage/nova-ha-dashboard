/**
 * Home Assistant — facade. The body lives in lib/ha/; this file keeps the
 * import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   ha/client.ts                         REST/WebSocket client, callService
 *   ha/entities.ts, zones.ts, registry.ts, twins.ts, health.ts, states.ts
 *                                        state projection pieces
 *   ha/entity-actions.ts                 setEntityAction
 *   ha/lighting/types.ts                 shared lighting shapes
 *   ha/lighting/commands.ts              lighting service call path, fan-out
 *   ha/lighting/light-model.ts           capabilities, presets, pinned lights
 *   ha/lighting/convergence.ts           brightness target follow-up
 *   ha/lighting/adaptive.ts              adaptive candlelight memory + transition
 *   ha/lighting/automations.ts           intensity thresholds, pinned presets
 *   ha/lighting/zone-action.ts           setZoneAction
 *   ha/lighting/zone-lighting-actions.ts setZoneLightingAction, setAllLightingAction
 *   ha/lighting/house-party.ts           House Party restore snapshot
 *   ha/lighting/store.ts                 SOLE state owner: House Party frame
 *                                        renderer + caches, rule migration latch
 *   ha/lighting/zone-rules.ts            light events, rule runner, rule trigger
 *
 * The state projection, router and weather re-exports below predate the split
 * and are kept so existing imports keep working.
 */
export { callService, haRest, subscribeHaStateChanges } from "./ha/client";
export { buildDashboardState } from "./state";
export {
  buildRouterStatusOnly,
  normalizeDataRateToMegabytesPerSecond,
  selectRouterRateEntityId,
} from "./modules/router/module";
export { warmWeatherCache } from "./modules/weather/module";

export type { HousePartyLightingFrame } from "./ha/lighting/types";
export { setZoneAction } from "./ha/lighting/zone-action";
export { setAllLightingAction, setZoneLightingAction } from "./ha/lighting/zone-lighting-actions";
export { captureHousePartyLightingRestore } from "./ha/lighting/house-party";
export { applyHousePartyLightingFrame, ensureZoneLightRulesMigrated } from "./ha/lighting/store";
export { applyAdaptiveCandlelightTransitions } from "./ha/lighting/adaptive";
export { applyLightingIntensityThresholds, applyPinnedLightPresets } from "./ha/lighting/automations";
export { applyZoneLightEvents, runZoneLightRules, triggerZoneLightRule } from "./ha/lighting/zone-rules";
export { setEntityAction } from "./ha/entity-actions";
