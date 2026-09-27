// Shared trace harness for the washing-machine suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import {
  blankWashingMachineState,
  recordWashingMachineSample,
  type WashingMachineState,
} from "../washing-machine";
import type { WashingMachineConfig } from "../config-schema";

export const CONFIG: WashingMachineConfig = {
  powerSensorEntityId: "sensor.washing_machine_power",
  entityIds: ["switch.washing_machine"],
  startWatts: 15,
  startSustainedSeconds: 120,
  endWatts: 5,
  endQuietSeconds: 300,
  minCycleKwh: 0.05,
  minCycleMinutes: 11,
  timer: { extendMinutes: 10, firstPeriodMinutes: 70, maxSampleGapSeconds: 90, stopSeconds: 120, stopWatts: 2 },
};

export const SAMPLE_SECONDS = 30;

/** The trace harness's own clock, so a seeded open wash can be timed to it. */
export const REPLAY_START_MS = Date.parse("2026-09-14T08:00:00.000Z");

/**
 * The thresholds the fixed plug is actually metered at: the off floor sits
 * below the 4-5 W a wash's own pauses draw, and the quiet window outlasts the
 * wash's own timer. See specs/power-meters.md §4.1, which records the nine days
 * of trace these numbers were read off.
 */
export const METERED_CONFIG: WashingMachineConfig = { ...CONFIG, endWatts: 2, endQuietSeconds: 180 };

/**
 * Replay a watt trace at a fixed sample interval, the way the power monitor
 * ticks. Each entry is [watts, minutes].
 */
export function replay(
  trace: Array<[number, number]>,
  state: WashingMachineState = blankWashingMachineState(),
  config: WashingMachineConfig = CONFIG,
) {
  let at = REPLAY_START_MS;
  let next = state;
  for (const [watts, minutes] of trace) {
    const ticks = (minutes * 60) / SAMPLE_SECONDS;
    for (let tick = 0; tick < ticks; tick += 1) {
      at += SAMPLE_SECONDS * 1000;
      next = recordWashingMachineSample(next, {
        at: new Date(at).toISOString(),
        config,
        costPerKwh: 0.3,
        elapsedHours: SAMPLE_SECONDS / 3600,
        watts,
      });
    }
  }
  return next;
}
