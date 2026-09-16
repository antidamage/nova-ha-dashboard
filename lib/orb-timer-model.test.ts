import { describe, expect, it } from "vitest";
import { completeTimer, timerSoundSlot, countdownText, type OrbTimer } from "./orb-timer-model";
const timer: OrbTimer = { id: "test", icon: "timer", label: "Egg", durationMs: 60000, startedAt: 0, endsAt: 60000, completedAt: null, dismissedAt: null };
describe("household timer", () => {
  it("completes exactly at its deadline even after a delayed tick", () => {
    expect(completeTimer(timer, 59999)).toBe(timer);
    expect(completeTimer(timer, 90000)?.completedAt).toBe(60000);
    expect(completeTimer(null, 90000)).toBeNull();
  });
  it("has ten sound slots and remains complete after sound expires", () => {
    const done = completeTimer(timer, 60000)!;
    expect(timerSoundSlot(done, 60000)).toBe(0);
    expect(timerSoundSlot(done, 89999)).toBe(0);
    expect(timerSoundSlot(done, 90000)).toBe(1);
    expect(timerSoundSlot(done, 359999)).toBe(9);
    expect(timerSoundSlot(done, 360000)).toBeNull();
    expect(completeTimer(done, 400000)).toBe(done);
    expect(timerSoundSlot({ ...done, dismissedAt: 70000 }, 90000)).toBeNull();
  });
  it("formats countdown and elapsed overrun without a new ETA", () => {
    expect(countdownText(66000)).toBe("1:06");
    expect(countdownText(-7000)).toBe("+0:07");
  });
  it("switches to hour:minutes at 60 minutes and above", () => {
    expect(countdownText(59 * 60_000)).toBe("59:00");
    expect(countdownText(60 * 60_000)).toBe("1:00");
    expect(countdownText(90 * 60_000 + 30_000)).toBe("1:30");
    expect(countdownText(125 * 60_000)).toBe("2:05");
  });
});
