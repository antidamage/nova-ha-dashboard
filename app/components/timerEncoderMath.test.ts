import { expect, it } from "vitest";
import { snapTimerMinutes, timerFractionToMinutes, timerMinutesToFraction } from "./timerEncoderMath";
it("uses the approved detents and logarithmic endpoints", () => {
  expect(timerFractionToMinutes(0)).toBe(0);
  expect(timerFractionToMinutes(1)).toBe(480);
  expect([.5, 1, 9, 12, 58, 114, 232, 469].map(snapTimerMinutes)).toEqual([0, 1, 9, 10, 60, 110, 225, 480]);
  for (const minutes of [1, 10, 60, 120, 240, 480]) expect(timerFractionToMinutes(timerMinutesToFraction(minutes))).toBe(minutes);
  expect(timerMinutesToFraction(10)).toBeGreaterThan(.4);
});
