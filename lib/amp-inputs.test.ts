import { describe, expect, it } from "vitest";
import { desiredFromSource, switchStateOf } from "./amp-inputs";
import type { HaState } from "./types";

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
