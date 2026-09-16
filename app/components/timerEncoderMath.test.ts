import { expect, it } from "vitest";
import { snapTimerMinutes, timerFractionToMinutes, timerMinutesToFraction } from "./timerEncoderMath";
it("uses the approved detents and logarithmic endpoints", () => {
  expect(timerFractionToMinutes(0)).toBe(0);
  expect(timerFractionToMinutes(1)).toBe(480);
  for (const minutes of [1, 10, 60, 120, 240, 480]) expect(timerFractionToMinutes(timerMinutesToFraction(minutes))).toBe(minutes);
  expect(timerMinutesToFraction(10)).toBeGreaterThan(.4);
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
