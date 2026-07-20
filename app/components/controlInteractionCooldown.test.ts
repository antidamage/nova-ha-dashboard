import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginControlInteraction,
  CONTROL_INTERACTION_COOLDOWN_MS,
  endControlInteraction,
  isControlInteractionCoolingDown,
  resetControlInteractionCooldownForTests,
} from "./controlInteractionCooldown";

describe("control interaction cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    resetControlInteractionCooldownForTests();
  });

  afterEach(() => {
    resetControlInteractionCooldownForTests();
    vi.useRealTimers();
  });

  it("blocks reconciliation for the whole gesture and six seconds after release", () => {
    beginControlInteraction();
    vi.advanceTimersByTime(30_000);
    expect(isControlInteractionCoolingDown()).toBe(true);

    endControlInteraction();
    vi.advanceTimersByTime(CONTROL_INTERACTION_COOLDOWN_MS - 1);
    expect(isControlInteractionCoolingDown()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isControlInteractionCoolingDown()).toBe(false);
  });
});
