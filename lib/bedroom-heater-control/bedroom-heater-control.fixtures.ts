// Shared planner harness for the bedroom heater suites. It is deliberately not
// a `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import {
  createInitialBedroomHeaterAutoState,
  planBedroomHeaterTick,
} from "../bedroom-heater-control";

export const ENTITY = "switch.tuya_mobile_bedroom_heater";
export const PREFS = { mode: "auto" as const, temperature: 20 };
// The planner is clock-free: nothing but a user action puts the heater in
// "auto", and the planner is only ever asked to run once it is.

export function plan(over: Partial<Parameters<typeof planBedroomHeaterTick>[0]> = {}) {
  return planBedroomHeaterTick({
    currentTemperature: 20,
    entityId: ENTITY,
    isOn: false,
    now: 1_000_000,
    preferences: PREFS,
    state: createInitialBedroomHeaterAutoState(),
    ...over,
  });
}
