import type { WashingMachineConfig } from "../config-schema";

export type WashRule = "day-gap" | "consecutive" | "spin";

/** How a cycle's person was decided. Absent on cycles stored before §4.5. */
export type WashAttribution = { at: string; rule?: WashRule; source: "auto" | "manual" };

export type AutoAttributionConfig = NonNullable<WashingMachineConfig["autoAttribution"]>;

export type WashingMachineCycle = {
  attribution?: WashAttribution;
  completion?: WashCompletion;
  costNzd: number;
  endedAt: string;
  id: string;
  kwh: number;
  /** A configured `dashboard.people` id, or null for unassigned. */
  person: string | null;
  startedAt: string;
};

export type WashingMachineOpenCycle = {
  attribution?: WashAttribution;
  person?: string | null;
  zeroSince?: string | null;
  completion?: WashCompletion;
  /** When the meter first rose above the start threshold, or null. */
  aboveSince: string | null;
  /** When the meter first fell below the end threshold, or null. */
  belowSince: string | null;
  costNzd: number;
  kwh: number;
  lastSampleAt: string;
  /** The previous reading, which is what the elapsed interval actually drew. */
  lastWatts: number;
  /** Set once the rise has been sustained long enough to count as a wash. */
  startedAt: string | null;
  /** Counter energy drawn while the rise was being confirmed (§7.3). */
  preStartKwh?: number;
};

export type WashingMachineState = {
  cycles: WashingMachineCycle[];
  open: WashingMachineOpenCycle | null;
  version: 1;
};

export type WashCompletion = { at: string; person: string | null; soundFile: string; discord: boolean; recommendation?: string };

export type WashingMachineTotals = {
  costNzd: number;
  cycles: number;
  kwh: number;
  person: string | null;
};
