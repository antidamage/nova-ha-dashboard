import type { BedroomHeaterMode, BedroomHeaterPreferences } from "../types";
import { autonomousClimateInputIsUsable } from "../autonomous-climate-safety";
import {
  BEDROOM_HEATER_DEFAULT_TARGET_C,
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_TARGET_C,
  INITIAL_BEDROOM_HEATER_AUTO_STATE,
} from "./constants";
import type { BedroomHeaterAutoState } from "./types";

/**
 * The only temperature sources permitted to drive or display the heater's room.
 *
 * The safety rule is unchanged: nothing outside this list may stand in, so an
 * unavailable room sensor disables Auto rather than silently substituting the
 * heater plug's own body temperature — which is far too damped to be a room
 * reading and would let Auto heat an already-warm room.
 *
 * What changed is where the list comes from. Callers already passed
 * `dashboard.bedroomHeater.temperatureEntityIds` in, and this function then
 * filtered it against a single hard-coded entity id — so the configured value
 * could never actually change anything, and one household's sensor was the only
 * one the product could ever trust. The configured list IS the trust list.
 */
export function roomTemperatureEntityIds(entityIds: readonly string[]) {
  return entityIds.filter((entityId) => entityId.trim().length > 0);
}

export function bedroomTemperatureStateIsFresh(
  state: { attributes?: Record<string, unknown>; last_reported?: string; last_updated?: string; last_changed?: string } | null | undefined,
  now: number = Date.now(),
) {
  const sourceReportedAt = state?.attributes?.source_reported_at;
  return autonomousClimateInputIsUsable(
    state ? {
      ...state,
      last_reported: typeof sourceReportedAt === "string" ? sourceReportedAt : state.last_reported,
      measurement: 0,
      sourceState: "available",
    } : undefined,
    now,
  );
}

export function bedroomTemperatureStateIsUsable(
  state: { state?: string; attributes?: Record<string, unknown>; last_reported?: string; last_updated?: string; last_changed?: string } | null | undefined,
  now: number = Date.now(),
) {
  const sourceReportedAt = state?.attributes?.source_reported_at;
  return autonomousClimateInputIsUsable(
    state ? {
      ...state,
      last_reported: typeof sourceReportedAt === "string" ? sourceReportedAt : state.last_reported,
      measurement: state.state,
      sourceState: state.state,
    } : undefined,
    now,
  );
}

export function createInitialBedroomHeaterAutoState(): BedroomHeaterAutoState {
  return { ...INITIAL_BEDROOM_HEATER_AUTO_STATE };
}

export function clampTargetTemperature(value: number) {
  return Math.min(BEDROOM_HEATER_MAX_TARGET_C, Math.max(BEDROOM_HEATER_MIN_TARGET_C, value));
}

/**
 * The stored mode, with the retired "manual" folded into "auto".
 *
 * Manual meant "hold the switch on regardless of temperature", which is what
 * Auto already does when the room is cold — the difference was never visible to
 * anyone, so the button went. Existing preferences still carry it, and the
 * honest reading of a heater someone left on is Auto, not Off.
 */
export function bedroomHeaterMode(preferences?: BedroomHeaterPreferences): BedroomHeaterMode {
  return preferences?.mode === "auto" || preferences?.mode === "manual" ? "auto" : "off";
}

export function bedroomHeaterTargetTemperature(preferences?: BedroomHeaterPreferences) {
  const value = preferences?.temperature;
  return typeof value === "number" && Number.isFinite(value)
    ? clampTargetTemperature(value)
    : BEDROOM_HEATER_DEFAULT_TARGET_C;
}

/**
 * Sleep-timer endpoint as a number, or null when no timer is set. Unparseable
 * values are treated as "no timer" rather than "expired": a corrupt preference
 * must never be the reason the heater shuts off.
 */
export function bedroomHeaterSleepTimerEndsAt(preferences?: BedroomHeaterPreferences) {
  const value = preferences?.offTimerEndsAt;
  if (typeof value !== "string") {
    return null;
  }
  const endsAt = new Date(value).getTime();
  return Number.isFinite(endsAt) ? endsAt : null;
}

export function bedroomHeaterSleepTimerExpired(
  preferences?: BedroomHeaterPreferences,
  now: number = Date.now(),
) {
  const endsAt = bedroomHeaterSleepTimerEndsAt(preferences);
  return endsAt !== null && endsAt <= now;
}
