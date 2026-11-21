import { describe, expect, it } from "vitest";
import { CONTROL_MODULES } from "../../../../lib/control-modules/catalogue";
import type { ControlPreset, ControlsConfig } from "../../../../lib/control-modules/types";
import type { DashboardState } from "../../../../lib/types";
import { isDialKind, slotCounts } from "../panel-slots/useSlotLayout";
import { buildSlotItems } from "./quickSlotModel";

/**
 * First paint (specs/quick-access-card.md, alex 2026-11-06): before the first
 * live snapshot every configured slot is on the card, so the amplifier is never
 * drawn alone with the rest arriving a moment later.
 */

function preset(id: string, moduleId: string, extra: Partial<ControlPreset> = {}): ControlPreset {
  return { binding: {}, driverId: null, features: {}, id, moduleId, name: id, roomId: null, variant: null, ...extra };
}

const CONTROLS: ControlsConfig = {
  presets: [
    preset("Lights", "room-lighting", { roomId: "everything" }),
    preset("Amplifier", "amplifier-control"),
    preset("Lounge", "aircon-heater-control", { variant: "aircon" }),
    preset("Bedroom", "aircon-heater-control", { variant: "heater", binding: { switchEntityIds: ["switch.bedroom_heater"] } }),
    preset("Outside", "outside-weather"),
  ],
  slots: ["Lights", "Amplifier", "Lounge", "Bedroom", "Outside"].map((id) => ({
    id: `slot-${id}`, presetId: id, roomId: null, surface: "quick-access" as const, visible: true,
  })),
};

function build(data: DashboardState | null, controls = CONTROLS) {
  return buildSlotItems({ climateZone: null, controlModules: CONTROL_MODULES, controls, data, surface: "quick-access" });
}

describe("buildSlotItems before the first live snapshot", () => {
  it("keeps every configured slot, in order, with the data-bound ones pending", () => {
    const items = build(null);
    expect(items.map((item) => item.key)).toEqual(CONTROLS.slots.map((slot) => slot.id));
    expect(items.map((item) => item.kind)).toEqual(["pending", "amplifier", "pending", "pending", "outside"]);
  });

  it("gives the layout the same dial count the live card will have", () => {
    const counts = slotCounts(build(null));
    expect(counts).toEqual({ count: 5, dials: 4, readings: 1, grownLines: [true] });
    expect(isDialKind("pending")).toBe(true);
  });

  it("names what each pending slot waits for, and reserves the lighting preset row", () => {
    const pending = build(null).filter((item) => item.kind === "pending");
    expect(pending.map((item) => item.kind === "pending" && [item.title, item.waitsFor, item.presetRow])).toEqual([
      ["Lights", "lighting-dial", true],
      ["Lounge", "climate-knob", false],
      ["Bedroom", "climate-knob", false],
    ]);
    const noPresets: ControlsConfig = {
      presets: [preset("Lights", "room-lighting", { roomId: "everything", features: { "preset-buttons": false } })],
      slots: [CONTROLS.slots[0]],
    };
    const [lights] = build(null, noPresets);
    expect(lights.kind === "pending" && lights.presetRow).toBe(false);
  });

  it("never pends once data exists: a missing device is still dropped", () => {
    const empty = { controls: CONTROLS, entities: [], preferences: {}, zones: [] } as unknown as DashboardState;
    expect(build(empty).map((item) => item.kind)).toEqual(["amplifier", "outside"]);
  });
});
