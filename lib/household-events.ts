/**
 * Household event spool — facade. The body lives in lib/household-events/;
 * this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   household-events/types.ts            event, input, batch, HA state change
 *   household-events/constants.ts        event kinds, retention, spool path
 *   household-events/normalize-model.ts  line validation, HA/task normalisers
 *   household-events/store.ts            SOLE owner: HouseholdEventLog, the
 *                                        shared instance, append helpers
 */
export type {
  HaStateChange,
  HouseholdEvent,
  HouseholdEventBatch,
  HouseholdEventInput,
  HouseholdEventKind,
  HouseholdEventSource,
} from "./household-events/types";
export { HOUSEHOLD_EVENT_KINDS } from "./household-events/constants";
export { normalizedHaStateChange, normalizedTaskSnapshots } from "./household-events/normalize-model";
export {
  appendHouseholdEvent,
  appendTaskSnapshotEvents,
  HouseholdEventLog,
  householdEventLog,
} from "./household-events/store";
