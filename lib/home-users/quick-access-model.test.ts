import { describe, expect, it } from "vitest";
import type { ControlsConfig } from "../control-modules/types";
import { quickAccessControlsFor } from "./quick-access-model";

const controls = {
  presets: [
    { id: "heater", moduleId: "aircon-heater-control", name: "Heater", roomId: null, driverId: null, variant: null, features: {}, binding: {} },
  ],
  slots: [
    { id: "shared-qa", surface: "quick-access", presetId: "heater", roomId: null, visible: true },
    { id: "clock-slot", surface: "clock", presetId: "heater", roomId: null, visible: true },
  ],
} as unknown as ControlsConfig;

const zones = [
  { id: "loft", name: "Loft" },
  { id: "member:bo", name: "All lights" },
];

describe("quickAccessControlsFor", () => {
  it("builds the person's card in order, generating lighting presets", () => {
    const result = quickAccessControlsFor(
      {
        id: "bo",
        quickAccess: [
          { kind: "room-lights", zoneId: "loft" },
          { kind: "all-lights" },
          { kind: "preset", presetId: "heater" },
        ],
      },
      controls,
      zones,
    );
    const quick = result.slots.filter((slot) => slot.surface === "quick-access");
    expect(quick.map((slot) => slot.presetId)).toEqual([
      "home-user:bo:room:loft",
      "home-user:bo:all-lights",
      "heater",
    ]);
    expect(result.presets.find((preset) => preset.id === "home-user:bo:room:loft")).toMatchObject({
      moduleId: "room-lighting",
      name: "Loft",
      roomId: "loft",
    });
    expect(result.presets.find((preset) => preset.id === "home-user:bo:all-lights")?.roomId).toBe("member:bo");
    // Other surfaces keep their shared slots.
    expect(result.slots.some((slot) => slot.id === "clock-slot")).toBe(true);
  });

  it("drops entries whose preset or room is gone", () => {
    const result = quickAccessControlsFor(
      { id: "cy", quickAccess: [{ kind: "preset", presetId: "missing" }, { kind: "room-lights", zoneId: "gone" }, { kind: "all-lights" }] },
      controls,
      zones,
    );
    expect(result.slots.filter((slot) => slot.surface === "quick-access")).toEqual([]);
  });
});
