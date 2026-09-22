import { describe, expect, it } from "vitest";
import { CONTROL_MODULES } from "./catalogue";
import { nextSlotId, resolveSlot, resolvedSurface } from "./slots";
import type { ControlPreset, ControlsConfig } from "./types";

/**
 * Slot resolution (specs/control-modules.md).
 *
 * Two claims worth pinning: a slot whose preset is missing renders NOTHING —
 * never an empty control, which is a permanent hole on the card — and a preset
 * whose room is "inherit" takes the slot's own room, which is the whole reason a
 * preset can be reused in another room.
 */

const LIGHTS: ControlPreset = {
  binding: {},
  driverId: null,
  features: {},
  id: "home-lights",
  moduleId: "room-lighting",
  name: "Lights",
  roomId: null,
  variant: null,
};

const OUTSIDE: ControlPreset = { ...LIGHTS, id: "outside", moduleId: "outside-weather", name: "Outside", roomId: "outside-zone" };

const CONTROLS: ControlsConfig = {
  presets: [LIGHTS, OUTSIDE],
  slots: [
    { id: "s-lights", presetId: "home-lights", roomId: "kitchen", surface: "quick-access", visible: true },
    { id: "s-gone", presetId: "deleted", roomId: null, surface: "quick-access", visible: true },
    { id: "s-outside", presetId: "outside", roomId: null, surface: "quick-access", visible: true },
    { id: "s-hidden", presetId: "outside", roomId: null, surface: "quick-access", visible: false },
  ],
};

describe("resolveSlot", () => {
  it("gives a preset that inherits the room its slot sits in", () => {
    const resolved = resolveSlot(CONTROLS.slots[0], CONTROLS.presets, CONTROL_MODULES);
    expect(resolved?.roomId).toBe("kitchen");
    expect(resolved?.roomInherited).toBe(true);
  });

  it("keeps the preset's own room when it names one, whatever the slot says", () => {
    const resolved = resolveSlot(CONTROLS.slots[2], CONTROLS.presets, CONTROL_MODULES);
    expect(resolved?.roomId).toBe("outside-zone");
    expect(resolved?.roomInherited).toBe(false);
  });

  it("returns nothing for a slot whose preset is gone", () => {
    expect(resolveSlot(CONTROLS.slots[1], CONTROLS.presets, CONTROL_MODULES)).toBeNull();
  });
});

describe("resolvedSurface", () => {
  it("drops the unusable and the hidden, and keeps the rest in order", () => {
    const resolved = resolvedSurface(CONTROLS, "quick-access", CONTROL_MODULES);
    expect(resolved.map((item) => item.slot.id)).toEqual(["s-lights", "s-outside"]);
  });
});

describe("nextSlotId", () => {
  it("never hands out an id that is taken", () => {
    const first = nextSlotId("quick-access", "outside", []);
    expect(first).toBe("quick-access-outside");
    expect(nextSlotId("quick-access", "outside", [{ ...CONTROLS.slots[0], id: first }])).toBe("quick-access-outside-2");
  });
});
