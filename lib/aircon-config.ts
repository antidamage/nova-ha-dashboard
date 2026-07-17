export const AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN = 5;
export const AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX = 60;
export const AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT = 30;

export function normalizeAirconOffTimerIncrementMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return AIRCON_OFF_TIMER_INCREMENT_MINUTES_DEFAULT;
  }

  return Math.max(
    AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN,
    Math.min(AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX, Math.round(parsed)),
  );
}

export function airconOffTimerIncrementMs(value: unknown) {
  return normalizeAirconOffTimerIncrementMinutes(value) * 60 * 1000;
}
