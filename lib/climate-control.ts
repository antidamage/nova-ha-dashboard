/**
 * Unified server climate controller — facade. The body lives in
 * lib/climate-control/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   climate-control/types.ts         RoomId, Direction, persisted room/state
 *                                    shapes, ClimateControlIntent
 *   climate-control/constants.ts     poll, settle and aircon cycle timings
 *   climate-control/store.ts         SOLE owner of globalThis and disk state:
 *                                    the runtime, per-instance thermostats and
 *                                    samples, persistence, climateControlState
 *   climate-control/device-model.ts  HA state readers, device signatures,
 *                                    entity resolution, dry support, median
 *   climate-control/commands.ts      emulated Dry entry/exit, external-change
 *                                    observation, executeActions, stopAndCancel
 *   climate-control/drive-aircon.ts  one air conditioner's tick
 *   climate-control/drive-heater.ts  one heater's tick
 *   climate-control/tick.ts          the tick, public state, module transitions,
 *                                    the controller's timer
 *   climate-control/intents.ts       claim, legacy entity actions, intents
 */
export type { ClimateControlIntent } from "./climate-control/types";
export { climateControlState } from "./climate-control/store";
export {
  applyClimateControlIntent,
  claimClimateControl,
  handleLegacyClimateAction,
} from "./climate-control/intents";
export {
  evaluateClimateControlNow,
  startClimateControl,
  stopClimateControlForTest,
} from "./climate-control/tick";
