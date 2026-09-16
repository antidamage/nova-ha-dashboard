export const TIMER_MAX_MINUTES = 480;
export function timerMinutesToFraction(minutes: number) { return minutes < 1 / 12 ? 0 : (Math.log(Math.min(480, minutes)) + 1) / (Math.log(480) + 1); }
/** Step in minutes for a given position: seconds-granularity below 10 min, then minutes. */
function timerStepMinutes(minutes: number) {
  if (minutes < 1) return 5 / 60;
  if (minutes < 5) return 10 / 60;
  if (minutes < 10) return 30 / 60;
  if (minutes < 20) return 1;
  if (minutes < 60) return 5;
  return 10;
}
export function snapTimerMinutes(minutes: number) {
  if (minutes < 1 / 12) return 0;
  const step = timerStepMinutes(minutes);
  return Math.min(480, Math.max(step, Math.round(minutes / step) * step));
}
export function timerFractionToMinutes(fraction: number) {
  if (fraction <= 0) return 0;
  return snapTimerMinutes(Math.exp(Math.min(1, fraction) * (Math.log(480) + 1) - 1));
}
