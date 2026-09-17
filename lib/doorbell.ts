/**
 * Doorbell decision logic.
 *
 * Everything in this file is pure: given a sequence and a configuration it
 * returns a decision. The stateful parts — dedupe, lockout counters, alert
 * fan-out, the lock call — live in doorbell-coordinator.ts, so the rules that
 * decide whether a door opens can be tested exhaustively without a server.
 *
 * The device deliberately has no say in this. It reports timings; Nova decides.
 * See smart-doorbell/PROJECT-PLAN.md §6.
 */

/*
 * Facade. The body lives in lib/doorbell/; this file keeps the import path
 * stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   doorbell/types.ts           sequence, config, secret, decision, alert shapes
 *   doorbell/knock-model.ts     payload validation, interval maths, secret scoring
 *   doorbell/schedule-model.ts  time-zone wall clock and schedule windows
 *   doorbell/decision-model.ts  decideDoorbell and buildAlert
 */
export type {
  DoorbellAccessConfig,
  DoorbellAlert,
  DoorbellConfig,
  DoorbellDecision,
  DoorbellFusionConfig,
  DoorbellKnock,
  DoorbellSchedule,
  DoorbellScheduleWindow,
  DoorbellSecretMeta,
  DoorbellSecretTemplate,
  DoorbellSequence,
  DoorbellVerdict,
  FusionInput,
  SecretMatch,
} from "./doorbell/types";
export {
  bestSecretMatch,
  DOORBELL_SEQUENCE_SCHEMA_VERSION,
  intervalsOf,
  isDoorbellSequence,
  scoreSecret,
} from "./doorbell/knock-model";
export { isWithinSchedule, localPartsInZone } from "./doorbell/schedule-model";
export { buildAlert, decideDoorbell } from "./doorbell/decision-model";
