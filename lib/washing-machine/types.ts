import type { WashingMachineConfig } from "../config-schema";

/** How a cycle's person was decided. `auto` is a default, never a tap. */
export type WashAttribution = { at: string; source: "auto" | "manual" };

export type WashTimerConfig = WashingMachineConfig["timer"];

/**
 * The wash's own timer: the first period a claim starts, the extensions while
 * the machine keeps drawing power to do a wash, and the stop that finishes it.
 *
 * It lives on the open cycle rather than in a store of its own because it is a
 * fact about that wash, and the household's single timer is a *mirror* of it —
 * set, extended and completed from here (specs/power-meters.md, "The wash's
 * timer").
 */
export type WashTimer = {
  startedAt: string;
  endsAt: string;
  /** How many times the period has run out while the machine was still going. */
  extensions: number;
  /** Set when the machine has been quiet long enough: the timer is done. */
  completedAt: string | null;
  /**
   * The household timer this wash set, while that timer is still the one it
   * set. Null once the household has replaced it with a timer of its own — the
   * wash's timer then counts down on the washing entry alone.
   */
  orbTimerId: string | null;
};

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
  /** The wash's timer, from the claim that started it (specs/power-meters.md). */
  timer?: WashTimer;
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

export type WashCompletion = { at: string; person: string | null; discord: boolean; recommendation?: string };

export type WashingMachineTotals = {
  costNzd: number;
  cycles: number;
  kwh: number;
  person: string | null;
};
