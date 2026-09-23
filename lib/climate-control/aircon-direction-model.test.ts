import { describe, expect, it } from "vitest";
import { airconTickDirection } from "./aircon-direction-model";

/*
 * Which direction the tick reports and drives (specs/aircon-auto-control.md §5.3).
 *
 * The rule this pins: `prefs.hvacMode` is reported for Auto and is never evidence
 * in Manual. It is the field Nova's own Auto leg writes, so reading it as the
 * owner's dictation held a heating unit short of its target and chose a direction
 * with no reading to check it against (2026-09-24 review of #47).
 */

const direction = (input: Partial<Parameters<typeof airconTickDirection>[0]>) =>
  airconTickDirection({
    filteredTemperature: null,
    mode: "manual",
    rawTemperature: null,
    running: null,
    seated: null,
    target: null,
    ...input,
  });

describe("airconTickDirection", () => {
  it("decides Manual's direction from the room", () => {
    expect(direction({ rawTemperature: 21, target: 27 })).toBe("heat");
    expect(direction({ rawTemperature: 30, target: 27 })).toBe("cool");
  });

  it("keeps a seated direction the room agrees with, and the running one with no reading", () => {
    expect(direction({ seated: "heat", rawTemperature: 21, target: 27 })).toBe("heat");
    expect(direction({ seated: "heat", target: 27 })).toBe("heat");
  });

  it("never uses the remembered preference as a Manual direction", () => {
    // A room a degree under its target, "cool" remembered, nothing seated.
    expect(direction({
      mode: "manual",
      rawTemperature: 26,
      target: 27,
      preferences: { autoMode: false, hvacMode: "cool" },
    })).toBe("heat");
    // No reading, nothing seated: no direction to run, and no guess.
    expect(direction({
      mode: "manual",
      target: 27,
      preferences: { autoMode: false, hvacMode: "cool" },
    })).toBeNull();
  });

  it("reports the remembered preference for Auto, which chooses its own direction", () => {
    expect(direction({
      mode: "auto",
      rawTemperature: 21,
      target: 27,
      preferences: { autoMode: true, hvacMode: "cool" },
    })).toBe("cool");
    expect(direction({ mode: "auto", rawTemperature: 21, running: "heat", target: 27 })).toBe("heat");
  });

  it("leaves a dry or fan-only status alone, and drives neither", () => {
    expect(direction({ seated: "dry", rawTemperature: 30, target: 27 })).toBe("dry");
    expect(direction({ seated: "fan_only", rawTemperature: 30, target: 27 })).toBe("fan_only");
    expect(direction({ running: "dry", rawTemperature: 30, target: 27 })).toBe("dry");
  });
});
