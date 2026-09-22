export const TIMER_MAX_MINUTES = 480;
/** The dial's own step: one position of the knob, and the unit the floor below is in. */
export const TIMER_DIAL_STEP = 0.001;
/**
 * The fraction the smallest duration a turn reaches sits at: one dial step above
 * the bottom, which is Off. The log scale's inverse bottoms out below zero there
 * — `timerFractionToMinutes` reads every fraction at or below zero as Off — so
 * without this floor the 20 s detent would be drawn *below* Off, and the dial
 * would read Off on the way up out of it. It has to stay a whole number of
 * `TIMER_DIAL_STEP`s above zero for that to hold, which the tests assert.
 */
export const TIMER_MIN_TURN_FRACTION = TIMER_DIAL_STEP;
export function timerMinutesToFraction(minutes: number) {
  if (minutes < 1 / 12) return 0;
  const log = Math.log(TIMER_MAX_MINUTES) + 1;
  return Math.max(TIMER_MIN_TURN_FRACTION, (Math.log(Math.min(TIMER_MAX_MINUTES, minutes)) + 1) / log);
}
/** Step in minutes for a given position: seconds-granularity below 10 min, then minutes. */
function timerStepMinutes(minutes: number) {
  if (minutes < 1) return 5 / 60;
  if (minutes < 5) return 10 / 60;
  if (minutes < 10) return 30 / 60;
  if (minutes < 30) return 1;
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
