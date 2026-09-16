import type { AirconPreferences } from "../types";
import { AIRCON_AUTO_STARTS_WINDOW_MS, INITIAL_AIRCON_AUTO_STATE, type AirconFanStep } from "./constants";
import type { ActiveAirconMode, AirconAutoPlan, AirconAutoReason, AirconAutoState } from "./types";
import { airconFanModeServiceValue } from "./mode-model";

export function createInitialAirconAutoState(): AirconAutoState {
  return { ...INITIAL_AIRCON_AUTO_STATE };
}

export function normalizeAirconAutoState(state?: Partial<AirconAutoState>): AirconAutoState {
  const merged = { ...INITIAL_AIRCON_AUTO_STATE, ...(state ?? {}) };
  return {
    ...merged,
    // This state round-trips through preferences, so the array can arrive absent
    // or as something other than an array. A malformed value must read as "no
    // starts recorded", never crash the loop that stops the compressor.
    recentStartsAt: Array.isArray(merged.recentStartsAt)
      ? merged.recentStartsAt.filter((at): at is number => typeof at === "number" && Number.isFinite(at))
      : [],
    sensorPendingSinceAt:
      typeof merged.sensorPendingSinceAt === "number" && Number.isFinite(merged.sensorPendingSinceAt)
        ? merged.sensorPendingSinceAt
        : null,
    settlingFromTemperature:
      typeof merged.settlingFromTemperature === "number" && Number.isFinite(merged.settlingFromTemperature)
        ? merged.settlingFromTemperature
        : null,
    userRequestAt:
      typeof merged.userRequestAt === "number" && Number.isFinite(merged.userRequestAt)
        ? merged.userRequestAt
        : null,
    lastTargetTemperature:
      typeof merged.lastTargetTemperature === "number" && Number.isFinite(merged.lastTargetTemperature)
        ? merged.lastTargetTemperature
        : null,
  };
}

/** Compressor starts still inside the trailing hour, oldest first. */
export function startsInWindow(recentStartsAt: number[], now: number) {
  return recentStartsAt.filter((at) => now - at < AIRCON_AUTO_STARTS_WINDOW_MS).sort((a, b) => a - b);
}

/**
 * The cycle bookkeeping, as preferences.
 *
 * This rides along on the `remember` payloads the loop already sends with every
 * transition, so it costs no extra preference write and no extra
 * preferences-history revision. It exists because the thermostat state otherwise
 * lives in a per-tab ref: a 30-minute direction hold that resets whenever the
 * kiosk reloads (which it does on every deploy) would not be a hold at all, and
 * two open dashboards would each keep their own idea of when the compressor last
 * started.
 */
export function airconAutoCycleRemember(state: AirconAutoState): AirconPreferences {
  return {
    autoLastMode: state.lastMode,
    autoLastModeAt: state.lastModeAt,
    autoLastTransitionAt: state.lastTransitionAt,
    autoRecentStartsAt: state.recentStartsAt,
    autoSettlingFromTemperature: state.settlingFromTemperature,
    autoSensorPendingSinceAt: state.sensorPendingSinceAt,
    autoUserRequestAt: state.userRequestAt,
    autoLastTargetTemperature: state.lastTargetTemperature,
  };
}

/** The cycle bookkeeping, read back out of preferences. */
export function airconAutoCycleStateFromPreferences(
  preferences?: AirconPreferences,
): Partial<AirconAutoState> {
  return {
    lastMode: preferences?.autoLastMode ?? null,
    lastModeAt: preferences?.autoLastModeAt ?? null,
    lastTransitionAt: preferences?.autoLastTransitionAt ?? null,
    recentStartsAt: preferences?.autoRecentStartsAt ?? [],
    settlingFromTemperature: preferences?.autoSettlingFromTemperature ?? null,
    sensorPendingSinceAt: preferences?.autoSensorPendingSinceAt ?? null,
    userRequestAt: preferences?.autoUserRequestAt ?? null,
    lastTargetTemperature: preferences?.autoLastTargetTemperature ?? null,
  };
}

export function activeAutoRemember(
  targetTemperature: number,
  mode: ActiveAirconMode,
  fanStep: AirconFanStep,
  cycle: AirconAutoState,
): AirconPreferences {
  return {
    autoMode: true,
    fanMode: airconFanModeServiceValue(fanStep),
    hvacMode: mode,
    quietMode: fanStep === "quiet",
    temperature: targetTemperature,
    turboMode: fanStep === "turbo",
    ...airconAutoCycleRemember(cycle),
  };
}

export function inactiveAutoRemember(
  targetTemperature: number,
  mode?: string,
  cycle?: AirconAutoState,
): AirconPreferences {
  return {
    autoMode: true,
    hvacMode: mode,
    temperature: targetTemperature,
    ...(cycle ? airconAutoCycleRemember(cycle) : {}),
  };
}

export function autoPlanState(state: AirconAutoState, overrides: Partial<AirconAutoState>): AirconAutoState {
  return { ...state, ...overrides };
}

export function noAirconActions(
  state: AirconAutoState,
  reason: AirconAutoReason,
  overrides: Partial<AirconAutoState> = {},
): AirconAutoPlan {
  return {
    actions: [],
    nextState: autoPlanState(state, overrides),
    reason,
  };
}

