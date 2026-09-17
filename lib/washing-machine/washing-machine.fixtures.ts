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
  typicalMinutes: 66,
  minCycleKwh: 0.05,
};

export const SAMPLE_SECONDS = 30;

/**
 * Replay a watt trace at a fixed sample interval, the way the power monitor
 * ticks. Each entry is [watts, minutes].
 */
export function replay(trace: Array<[number, number]>, state: WashingMachineState = blankWashingMachineState()) {
  let at = new Date("2026-09-14T08:00:00.000Z").getTime();
  let next = state;
  for (const [watts, minutes] of trace) {
    const ticks = (minutes * 60) / SAMPLE_SECONDS;
    for (let tick = 0; tick < ticks; tick += 1) {
      at += SAMPLE_SECONDS * 1000;
      next = recordWashingMachineSample(next, {
        at: new Date(at).toISOString(),
        config: CONFIG,
        costPerKwh: 0.3,
        elapsedHours: SAMPLE_SECONDS / 3600,
        watts,
      });
    }
  }
  return next;
}
