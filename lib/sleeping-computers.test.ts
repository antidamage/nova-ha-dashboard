import { afterEach, describe, expect, it } from "vitest";
import {
  clearComputerSleeping,
  isComputerSleeping,
  markComputerSleeping,
  resetSleepingComputersForTest,
} from "./sleeping-computers";

afterEach(() => {
  resetSleepingComputersForTest();
});

describe("sleeping computers registry", () => {
  it("reports a freshly slept machine as sleeping", () => {
    markComputerSleeping("studio-desktop", 60_000, 1_000);
    expect(isComputerSleeping("studio-desktop", 2_000)).toBe(true);
  });

  it("does not report an untouched machine as sleeping", () => {
    expect(isComputerSleeping("media-desktop")).toBe(false);
  });

  it("stops suppressing once the window lapses", () => {
    markComputerSleeping("media-desktop", 60_000, 0);
    expect(isComputerSleeping("media-desktop", 30_000)).toBe(true);
    expect(isComputerSleeping("media-desktop", 60_001)).toBe(false);
    // Expiry is pruned, so a later check without a fresh mark stays false.
    expect(isComputerSleeping("media-desktop", 70_000)).toBe(false);
  });

  it("clears suppression explicitly when a sleep dispatch fails", () => {
    markComputerSleeping("studio-desktop", 60_000, 0);
    clearComputerSleeping("studio-desktop");
    expect(isComputerSleeping("studio-desktop", 1_000)).toBe(false);
  });
});
