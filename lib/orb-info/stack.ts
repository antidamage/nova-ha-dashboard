import type { OrbModuleOutput, OrbStackEntry } from "./types";

/**
 * Status orb stack ordering (specs/status-orb-stack.md, Round 2).
 *
 * 1. Alerting entries, most recent alert first.
 * 2. Running countdowns (timer, washing, rain-arriving), shortest remaining first.
 * 3. `on` entries in the user's arranged order.
 * 4. Gym alerts, always last (see `ORB_SINKING_ALERT_MODULE_IDS`).
 * `off` entries never appear. Pure; the Apple TV port runs the same case table
 * (stack-cases.json).
 */

export const ORB_COUNTDOWN_MODULE_IDS: readonly string[] = ["timer", "washing", "rain-arriving"];

export function isCountdownModule(moduleId: string): boolean {
  return ORB_COUNTDOWN_MODULE_IDS.includes(moduleId);
}

/**
 * Modules whose alert sinks to the bottom of the stack instead of the top
 * (Adeline, 2026-09-16). A gym alert is typically a week old and needs
 * physical work to clear, so anything else on the stack is more useful now.
 * They still order among themselves by alert recency.
 */
export const ORB_SINKING_ALERT_MODULE_IDS: readonly string[] = ["gym", "gym-progress"];

export function isSinkingAlertModule(moduleId: string): boolean {
  return ORB_SINKING_ALERT_MODULE_IDS.includes(moduleId);
}

export type OrbEntryState = "off" | "on" | "alert" | "countdown";

export type OrbStackItem = { entry: OrbStackEntry; output: OrbModuleOutput; state: Exclude<OrbEntryState, "off"> };

export function orbEntryState(entry: OrbStackEntry, output: OrbModuleOutput | undefined): OrbEntryState {
  if (!output || entry.enabled === false) return "off";
  if (output.alert && output.active !== false) return "alert";
  if (output.active === false) return "off";
  if (isCountdownModule(entry.moduleId)) return "countdown";
  if (entry.showOnlyWhenAlerting) return "off";
  return "on";
}

/**
 * `alertSince` supplies a first-seen time for alerts whose module has no
 * timestamp of its own (a threshold crossing), so recency still orders them.
 */
export function orderOrbStack(
  entries: readonly OrbStackEntry[],
  outputs: Readonly<Record<string, OrbModuleOutput | undefined>>,
  alertSince: Readonly<Record<string, number | undefined>> = {},
): OrbStackItem[] {
  const alerts: Array<OrbStackItem & { at: number; index: number }> = [];
  const sinkingAlerts: Array<OrbStackItem & { at: number; index: number }> = [];
  const countdowns: Array<OrbStackItem & { remaining: number; index: number }> = [];
  const on: OrbStackItem[] = [];
  entries.forEach((entry, index) => {
    const output = outputs[entry.id];
    const state = orbEntryState(entry, output);
    if (state === "off" || !output) return;
    if (state === "alert") {
      const alert = { entry, output, state, index, at: output.alertAt ?? alertSince[entry.id] ?? 0 };
      (isSinkingAlertModule(entry.moduleId) ? sinkingAlerts : alerts).push(alert);
    } else if (state === "countdown") countdowns.push({ entry, output, state, index, remaining: Math.max(0, output.remainingMs ?? 0) });
    else on.push({ entry, output, state });
  });
  alerts.sort((a, b) => b.at - a.at || a.index - b.index);
  sinkingAlerts.sort((a, b) => b.at - a.at || a.index - b.index);
  countdowns.sort((a, b) => a.remaining - b.remaining || a.index - b.index);
  const strip = ({ entry, output, state }: OrbStackItem) => ({ entry, output, state });
  return [...alerts.map(strip), ...countdowns.map(strip), ...on, ...sinkingAlerts.map(strip)];
}

/** The entry the orb shows at rest. */
export function resolveActiveEntry(
  entries: readonly OrbStackEntry[],
  outputs: Readonly<Record<string, OrbModuleOutput | undefined>>,
  alertSince?: Readonly<Record<string, number | undefined>>,
): OrbStackItem | null {
  return orderOrbStack(entries, outputs, alertSince)[0] ?? null;
}
