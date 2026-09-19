import { describe, expect, it } from "vitest";
import { decideAmpAction, desiredFromSource, switchStateOf, type AmpDecisionInput } from "./amp-power-control";
import type { HaState } from "./types";

/** Armed, holding the plug, Apple TV on, plug on, nothing outstanding. */
const SETTLED: AmpDecisionInput = {
  actual: "on",
  armed: true,
  desired: "on",
  minIntervalMs: 30_000,
  msSinceLastCommand: null,
  msUnavailable: null,
  owned: true,
  staleHeld: false,
  staleRestoreMs: 600_000,
};

const decide = (overrides: Partial<AmpDecisionInput>) => decideAmpAction({ ...SETTLED, ...overrides });

function statesOf(entries: Record<string, string>) {
  return new Map<string, HaState>(
    Object.entries(entries).map(([entity_id, state]) => [entity_id, { entity_id, state, attributes: {} }]),
  );
}

describe("desiredFromSource", () => {
  it("reads the configured off-states as off", () => {
    expect(desiredFromSource("off", ["off", "standby"])).toBe("off");
    expect(desiredFromSource("standby", ["off", "standby"])).toBe("off");
  });

  it("treats every other live state as on, including idle and paused", () => {
    // Adeline's choice: powered on, not playing. A pause must not cut the amp
    // mid-film (specs/amp-appletv-power.md §1.1).
    for (const state of ["idle", "playing", "paused", "buffering", "on"]) {
      expect(desiredFromSource(state, ["off", "standby"])).toBe("on");
    }
  });

  it("has no opinion when the Apple TV cannot be seen", () => {
    expect(desiredFromSource("unavailable", ["off"])).toBeNull();
    expect(desiredFromSource("unknown", ["off"])).toBeNull();
    expect(desiredFromSource(undefined, ["off"])).toBeNull();
  });
});

describe("switchStateOf", () => {
  const ids = ["switch.tuya_mobile_floating_meter", "switch.floating_meter"];

  it("reads the plug through whichever twin Home Assistant has", () => {
    expect(switchStateOf(ids, statesOf({ "switch.floating_meter": "off" }))).toBe("off");
    expect(switchStateOf(ids, statesOf({ "switch.tuya_mobile_floating_meter": "on" }))).toBe("on");
  });

  it("is null when no twin can be read", () => {
    expect(switchStateOf(ids, statesOf({}))).toBeNull();
    expect(switchStateOf(ids, statesOf({ "switch.floating_meter": "unavailable" }))).toBeNull();
  });

  it("takes any twin reading on as the socket being on", () => {
    expect(
      switchStateOf(ids, statesOf({ "switch.floating_meter": "off", "switch.tuya_mobile_floating_meter": "on" })),
    ).toBe("on");
  });
});

describe("decideAmpAction — the gate", () => {
  it("does nothing at all under another category", () => {
    // "it should ONLY EVER power on or off the floating meter in response to
    // the apple tv if that category is selected" (§4.2).
    expect(decide({ armed: false, owned: false, desired: "off", actual: "on" })).toEqual({ type: "none" });
  });

  it("hands the plug back when the category moves away", () => {
    expect(decide({ armed: false, owned: true, desired: "off", actual: "off" })).toEqual({ type: "release" });
  });
});

describe("decideAmpAction — following the Apple TV", () => {
  it("switches the amp off when the Apple TV sleeps", () => {
    expect(decide({ desired: "off", actual: "on" })).toEqual({ type: "command", state: "off" });
  });

  it("switches the amp on when the Apple TV wakes", () => {
    expect(decide({ desired: "on", actual: "off" })).toEqual({ type: "command", state: "on" });
  });

  it("does nothing when the plug already matches", () => {
    expect(decide({ desired: "off", actual: "off" })).toEqual({ type: "none" });
  });

  it("corrects the plug back when it is flipped by hand", () => {
    // Level-triggered against what the switch ACTUALLY reads, so a dropped
    // call is retried and a manual flip is corrected (§4.5).
    expect(decide({ desired: "on", actual: "off", msSinceLastCommand: 45_000 })).toEqual({
      type: "command",
      state: "on",
    });
  });

  it("does not guess when the plug cannot be read", () => {
    expect(decide({ desired: "off", actual: null })).toEqual({ type: "none" });
  });
});

describe("decideAmpAction — the 30-second rate limit", () => {
  it("waits at 29 seconds and commands at 30", () => {
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: 29_000 })).toEqual({ type: "wait" });
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: 30_000 })).toEqual({
      type: "command",
      state: "off",
    });
  });

  it("does not rate-limit the first command after taking the plug", () => {
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: null })).toEqual({
      type: "command",
      state: "off",
    });
  });

  it("collapses on/off/on inside one window to nothing at all", () => {
    // The controller holds no queue. Off is wanted 5s in and waits; by the time
    // the window expires the Apple TV is on again, the plug already is, and the
    // superfluous pair has vanished rather than been replayed (§4.5).
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: 5_000 })).toEqual({ type: "wait" });
    expect(decide({ desired: "on", actual: "on", msSinceLastCommand: 30_000 })).toEqual({ type: "none" });
  });

  it("issues a spaced-out secondary change once the window expires", () => {
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: 10_000 })).toEqual({ type: "wait" });
    expect(decide({ desired: "off", actual: "on", msSinceLastCommand: 31_000 })).toEqual({
      type: "command",
      state: "off",
    });
  });
});

describe("decideAmpAction — when the Apple TV cannot be seen", () => {
  it("takes no action while it is briefly unreadable", () => {
    // unavailable is not off. An HA restart must not flap the amp (§4.4).
    expect(decide({ desired: null, actual: "on", msUnavailable: 120_000 })).toEqual({ type: "none" });
  });

  it("restores the plug after ten minutes of it", () => {
    expect(decide({ desired: null, actual: "off", msUnavailable: 600_000 })).toEqual({ type: "release" });
  });

  it("releases only once, then waits for the Apple TV to come back", () => {
    expect(decide({ desired: null, actual: "on", msUnavailable: 900_000, staleHeld: true })).toEqual({
      type: "none",
    });
  });

  it("does not release a plug it is not holding", () => {
    expect(decide({ desired: null, actual: "on", msUnavailable: 900_000, owned: false })).toEqual({ type: "none" });
  });
});
