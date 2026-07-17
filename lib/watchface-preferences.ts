import type { DashboardPreferences, WatchfacePreferences } from "./types";

export const WATCHFACE_IDLE_TIMEOUT_DEFAULT_MS = 5 * 60 * 1000;
export const WATCHFACE_IDLE_TIMEOUT_MIN_MS = 30 * 1000;
export const WATCHFACE_IDLE_TIMEOUT_MAX_MS = 60 * 60 * 1000;
export const GYM_ALERT_THRESHOLD_DEFAULT_HOURS = 46;
export const GYM_ALERT_THRESHOLD_MIN_HOURS = 1;
export const GYM_ALERT_THRESHOLD_MAX_HOURS = 168;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeWatchfaceIdleTimeoutMs(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return WATCHFACE_IDLE_TIMEOUT_DEFAULT_MS;
  }
  return clamp(Math.round(parsed), WATCHFACE_IDLE_TIMEOUT_MIN_MS, WATCHFACE_IDLE_TIMEOUT_MAX_MS);
}

export function normalizeGymAlertThresholdHours(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return GYM_ALERT_THRESHOLD_DEFAULT_HOURS;
  }
  return clamp(Math.round(parsed), GYM_ALERT_THRESHOLD_MIN_HOURS, GYM_ALERT_THRESHOLD_MAX_HOURS);
}

export function daysSinceGymReset(gymLastResetAt: unknown, now = Date.now()) {
  const resetAt = typeof gymLastResetAt === "string" ? Date.parse(gymLastResetAt) : Number(gymLastResetAt);
  if (!Number.isFinite(resetAt) || resetAt <= 0) {
    return 0;
  }

  const elapsed = Math.max(0, now - resetAt);
  return Math.max(0, Math.min(9, Math.floor(elapsed / MS_PER_DAY)));
}

export function normalizedWatchfacePreferences(preferences?: DashboardPreferences): WatchfacePreferences {
  const watchface = preferences?.watchface ?? {};
  return {
    ...watchface,
    daysSinceGym: daysSinceGymReset(watchface.gymLastResetAt),
    gymAlertThresholdHours: normalizeGymAlertThresholdHours(watchface.gymAlertThresholdHours),
    idleTimeoutMs: normalizeWatchfaceIdleTimeoutMs(watchface.idleTimeoutMs),
  };
}

export function withComputedWatchfacePreferences(preferences: DashboardPreferences): DashboardPreferences {
  return {
    ...preferences,
    watchface: normalizedWatchfacePreferences(preferences),
  };
}
