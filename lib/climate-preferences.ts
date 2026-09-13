import { LEGACY_AIRCON_INSTANCE_ID, LEGACY_HEATER_INSTANCE_ID } from "./climate-instances";
import type { AirconPreferences, BedroomHeaterPreferences, DashboardPreferences } from "./types";

/**
 * Where a climate instance's remembered settings live.
 *
 * The first air conditioner and the first heater keep the historical
 * `preferences.aircon` / `preferences.bedroomHeater` keys; every other instance
 * gets its own entry under `preferences.climate[id]`.
 *
 * That split is deliberate. Moving the existing keys would mean migrating the
 * live store, and a mistake there loses a heater's mode and schedule — so the
 * safe change is the one where the running installation's data does not move at
 * all. Everything reads and writes through here, so callers never have to know
 * which of the two shapes applies.
 */

export function airconPreferencesFor(
  preferences: DashboardPreferences | undefined,
  instanceId: string,
): AirconPreferences | undefined {
  if (instanceId === LEGACY_AIRCON_INSTANCE_ID) return preferences?.aircon;
  return preferences?.climate?.[instanceId]?.aircon;
}

export function heaterPreferencesFor(
  preferences: DashboardPreferences | undefined,
  instanceId: string,
): BedroomHeaterPreferences | undefined {
  if (instanceId === LEGACY_HEATER_INSTANCE_ID) return preferences?.bedroomHeater;
  return preferences?.climate?.[instanceId]?.heater;
}

/**
 * A patch to hand `mergeDashboardPreferences`. Shaped for the instance, so a
 * caller writes the same thing whichever storage it lands in.
 */
export function airconPreferencesPatch(
  instanceId: string,
  patch: Partial<AirconPreferences>,
): Partial<DashboardPreferences> {
  if (instanceId === LEGACY_AIRCON_INSTANCE_ID) return { aircon: patch as AirconPreferences };
  return { climate: { [instanceId]: { aircon: patch as AirconPreferences } } };
}

export function heaterPreferencesPatch(
  instanceId: string,
  patch: Partial<BedroomHeaterPreferences>,
): Partial<DashboardPreferences> {
  if (instanceId === LEGACY_HEATER_INSTANCE_ID) return { bedroomHeater: patch as BedroomHeaterPreferences };
  return { climate: { [instanceId]: { heater: patch as BedroomHeaterPreferences } } };
}

/** Bounds of the household "Knob range" (specs/temperature-encoder.md). */
export const CLIMATE_TARGET_RANGE_MIN = 5;
export const CLIMATE_TARGET_RANGE_MAX = 30;
export const CLIMATE_TARGET_RANGE_STEP = 0.5;
export const CLIMATE_TARGET_RANGE_MIN_GAP = 1;

/**
 * A stored or requested knob range, snapped to 0.5 degC inside 5-30 with the
 * thumbs at least 1 degC apart. Throws on anything that is not two numbers.
 */
export function normalizeClimateTargetRange(value: unknown): { min: number; max: number } {
  const input = value as { min?: unknown; max?: unknown } | null;
  const rawMin = Number(input?.min);
  const rawMax = Number(input?.max);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) throw new Error("Knob range needs a numeric min and max");
  const snap = (n: number) => Math.round(n / CLIMATE_TARGET_RANGE_STEP) * CLIMATE_TARGET_RANGE_STEP;
  const bound = (n: number) => Math.max(CLIMATE_TARGET_RANGE_MIN, Math.min(CLIMATE_TARGET_RANGE_MAX, snap(n)));
  let min = bound(Math.min(rawMin, rawMax));
  let max = bound(Math.max(rawMin, rawMax));
  if (max - min < CLIMATE_TARGET_RANGE_MIN_GAP) {
    max = Math.min(CLIMATE_TARGET_RANGE_MAX, min + CLIMATE_TARGET_RANGE_MIN_GAP);
    min = max - CLIMATE_TARGET_RANGE_MIN_GAP;
  }
  return { min, max };
}
