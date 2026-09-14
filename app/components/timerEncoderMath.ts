export const TIMER_MAX_MINUTES = 480;
export function timerMinutesToFraction(minutes: number) { return minutes < 1 ? 0 : (Math.log(Math.min(480, minutes)) + 1) / (Math.log(480) + 1); }
export function snapTimerMinutes(minutes: number) {
  if (minutes < 1) return 0;
  const step = minutes <= 10 ? 1 : minutes <= 60 ? 5 : minutes <= 120 ? 10 : minutes <= 240 ? 15 : 30;
  return Math.min(480, Math.max(1, Math.round(minutes / step) * step));
}
export function timerFractionToMinutes(fraction: number) { return snapTimerMinutes(Math.exp(Math.max(0, Math.min(1, fraction)) * (Math.log(480) + 1) - 1)); }
