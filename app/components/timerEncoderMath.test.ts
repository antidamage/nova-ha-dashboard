import { expect, it } from "vitest";
import { TIMER_DIAL_STEP, TIMER_MIN_TURN_FRACTION, snapTimerMinutes, timerFractionToMinutes, timerMinutesToFraction } from "./timerEncoderMath";
it("uses the approved detents and logarithmic endpoints", () => {
  expect(timerFractionToMinutes(0)).toBe(0);
  expect(timerFractionToMinutes(1)).toBe(480);
  for (const minutes of [1, 10, 60, 120, 240, 480]) expect(timerFractionToMinutes(timerMinutesToFraction(minutes))).toBe(minutes);
  expect(timerMinutesToFraction(10)).toBeGreaterThan(.4);
});
it("keeps the smallest duration a turn reaches above Off, in both directions", () => {
  // 20 s is the floor of the turn: it sits one step above the bottom, and Off is
  // the bottom itself, so a duration never reads Off on the way up.
  expect(timerMinutesToFraction(1 / 3)).toBe(0.001);
  expect(timerFractionToMinutes(timerMinutesToFraction(1 / 3))).toBe(1 / 3);
  expect(timerMinutesToFraction(0.25)).toBe(0.001);
  expect(timerFractionToMinutes(0)).toBe(0);
  // The floor only works while it is a whole step of the dial's own grid, above
  // the bottom: change the step and this fails rather than the dial going quiet.
  expect(TIMER_MIN_TURN_FRACTION).toBeGreaterThan(0);
  expect(TIMER_MIN_TURN_FRACTION % TIMER_DIAL_STEP).toBe(0);
  expect(timerMinutesToFraction(1 / 3)).toBe(TIMER_MIN_TURN_FRACTION);
});
it("snaps to a graduated step: 5s under 1m, 10s to 5m, 30s to 10m, 1m to 30m, 5m to 60m, 10m above", () => {
  expect(snapTimerMinutes(0)).toBe(0);
  expect(snapTimerMinutes(0.02)).toBe(0);
  expect(snapTimerMinutes(1 / 12 + 0.001)).toBeCloseTo(5 / 60, 5);
  expect(snapTimerMinutes(0.5)).toBeCloseTo(30 / 60, 5);
  expect(snapTimerMinutes(2)).toBeCloseTo(120 / 60, 5);
  expect(snapTimerMinutes(4.99)).toBeCloseTo(300 / 60, 5);
  expect(snapTimerMinutes(7)).toBeCloseTo(7, 5);
  expect(snapTimerMinutes(9.9)).toBeCloseTo(10, 5);
  expect(snapTimerMinutes(12)).toBe(12);
  expect(snapTimerMinutes(19.6)).toBe(20);
  expect(snapTimerMinutes(25.4)).toBe(25);
  expect(snapTimerMinutes(29.6)).toBe(30);
  expect(snapTimerMinutes(58)).toBe(60);
  expect(snapTimerMinutes(114)).toBe(110);
  expect(snapTimerMinutes(232)).toBe(230);
  expect(snapTimerMinutes(469)).toBe(470);
  expect(snapTimerMinutes(475)).toBe(480);
});
