/**
 * Who is at the wall panel, and what they did while they were there.
 *
 * Nocturnium is a shared kiosk with no login and no way to have one — both LAN
 * vhosts answer a flat 403 with no login path, by design. `callerAttribution()`
 * answers "which machine", which for the panel is the same answer every time.
 * A daemon on Nocturnium identifies the person at its camera by face and posts
 * observations here; this module turns those into sessions and joins control
 * changes to them.
 *
 * `specs/kiosk-attribution.md` owns the design. The consent boundary is that
 * spec's and is not widened here: `/identify` answers `null` for a face it does
 * not know, never a nearest neighbour, so an unrecognised person is recorded as
 * unidentified rather than guessed at.
 *
 * **This records. It does not refuse.** A later gate could read the same join,
 * but nothing here is a switch waiting to be flipped.
 *
 * The pure half sits at the top and takes `now` explicitly, so the state
 * machine is testable without timers or a clock.
 *
 * Facade. The body lives in lib/kiosk-witness/; this file keeps the import
 * path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   kiosk-witness/types.ts           action, session, state, timings, identity
 *   kiosk-witness/constants.ts       empty state, no-identity answer
 *   kiosk-witness/session-model.ts   env timings and the pure state machine
 *   kiosk-witness/store.ts           SOLE owner: cache and state file
 */
export type {
  KioskAction,
  KioskIdentity,
  KioskSession,
  WitnessState,
  WitnessTimings,
} from "./kiosk-witness/types";
export { EMPTY_STATE, NO_IDENTITY } from "./kiosk-witness/constants";
export {
  activityView,
  applyAction,
  applyObservation,
  applyTouch,
  currentIdentity,
  digestDue,
  identityHolds,
  markDigestSent,
  readTimings,
} from "./kiosk-witness/session-model";
export { loadState, resetCache, saveState } from "./kiosk-witness/store";
