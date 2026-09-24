import { describe, expect, it } from "vitest";
import { CONTROL_MODULES } from "../../../../lib/control-modules/catalogue";
import type { ControlPreset, ControlsConfig } from "../../../../lib/control-modules/types";
import type { DashboardState, DashboardZone } from "../../../../lib/types";
import { buildSlotItems } from "./quickSlotModel";

/**
 * The Quick Access card, from configuration (specs/control-modules.md).
 *
 * The claim this pins is the one the whole change rests on: the derived slot
 * order and the derived bindings produce the SAME five controls, in the same
 * rows, the card had when they were hard-coded — and a preset that is pointed
 * somewhere else moves, without the card knowing anything about it.
 */

function entity(entity_id: string, state = "off", attributes: Record<string, unknown> = {}) {
  return { attributes, domain: entity_id.split(".")[0], entity_id, name: entity_id, state } as never;
}

function zone(id: string, name: string, entities: unknown[]): DashboardZone {
  return {
    brightnessPct: 0,
    counts: { climate: 0, cover: 0, fan: 0, humidifier: 0, light: 0, sensor: 0, switch: 0 },
    entities: entities as never,
    id,
    isOn: false,
    name,
  } as DashboardZone;
}

const CLIMATE_ZONE = zone("climate", "Climate", [
  entity("climate.lounge", "cool", { current_temperature: 21, temperature: 23 }),
  entity("switch.lounge_quiet"),
]);

const HOME_ZONE = zone("everything", "Home", [entity("light.lounge_lamp", "on")]);

const BEDROOM_SWITCH = entity("switch.bedroom_heater", "on");

const STATE = {
  climateControl: { lounge: { dryEmulatable: false } },
  controls: { presets: [], slots: [] },
  // The heater's switch list is resolved from the flat entity list, the way the
  // full card's does — a zone's entities are not what a bound id is looked up in.
  entities: [entity("climate.lounge", "cool"), BEDROOM_SWITCH],
  preferences: { aircon: { temperature: 22 } },
  spectrumCursors: { everything: { x: 0.1, y: 0.2 } },
  zones: [CLIMATE_ZONE, HOME_ZONE],
} as unknown as DashboardState;

const LIGHTS: ControlPreset = {
  binding: {}, driverId: null, features: {}, id: "home-lights", moduleId: "room-lighting",
  name: "Lights", roomId: "everything", variant: null,
};

const AIRCON: ControlPreset = {
  binding: { matchTokens: ["gree"] }, driverId: "gree-air-conditioner", features: {}, id: "lounge",
  moduleId: "aircon-heater-control", name: "Lounge", roomId: null, variant: "aircon",
};

const HEATER: ControlPreset = {
  binding: { switchEntityIds: ["switch.bedroom_heater"], temperatureEntityIds: [], humidityEntityIds: [] },
  driverId: "sample-heater-wifi-switch", features: {}, id: "bedroom", moduleId: "aircon-heater-control",
  name: "Bedroom", roomId: null, variant: "heater",
};

const OUTSIDE: ControlPreset = {
  binding: {}, driverId: null, features: {}, id: "outside", moduleId: "outside-weather",
  name: "Outside", roomId: null, variant: null,
};

const AMPLIFIER: ControlPreset = {
  binding: {}, driverId: null, features: {}, id: "amplifier", moduleId: "amplifier-control",
  name: "Amplifier", roomId: null, variant: null,
};

function slot(id: string, presetId: string, roomId: string | null = null) {
  return { id, presetId, roomId, surface: "quick-access" as const, visible: true };
}

function build(controls: ControlsConfig, state: DashboardState = STATE) {
  // From the same state the way Dashboard.tsx does, so a test that empties the
  // climate zone is testing resolution rather than an inconsistency in the test.
  const climateZone = state.zones.find((candidate) => candidate.id === "climate") ?? null;
  return buildSlotItems({ climateZone, controlModules: CONTROL_MODULES, controls, data: state, preferences: state.preferences, surface: "quick-access" });
}

describe("buildSlotItems", () => {
  it("builds a panel's own content as an item of its own", () => {
    // Every panel defaults to one slot holding a `panel-content` module
    // (Adeline, 2026-09-25), so the panel draws the content it came with and
    // nothing about the dashboard changes.
    const controls: ControlsConfig = {
      presets: [{ binding: {}, driverId: null, features: {}, id: "panel-clock", moduleId: "panel-content", name: "Clock", roomId: null, variant: null }],
      slots: [{ id: "clock-content", presetId: "panel-clock", roomId: null, surface: "clock", visible: true }],
    };
    const items = buildSlotItems({
      climateZone: null,
      controlModules: CONTROL_MODULES,
      controls,
      data: STATE,
      preferences: STATE.preferences,
      surface: "clock",
    });
    expect(items.map((item) => item.kind)).toEqual(["panel"]);
    expect(items[0].presetId).toBe("panel-clock");
    // And nothing from another panel's surface leaks in.
    expect(buildSlotItems({
      climateZone: null,
      controlModules: CONTROL_MODULES,
      controls,
      data: STATE,
      preferences: STATE.preferences,
      surface: "quick-access",
    })).toEqual([]);
  });

  it("reproduces the card's grid order from the derived slot order", () => {
    const items = build({
      presets: [AIRCON, HEATER, LIGHTS, AMPLIFIER, OUTSIDE],
      slots: [slot("s1", "home-lights", "everything"), slot("s2", "amplifier"), slot("s3", "lounge"), slot("s4", "bedroom"), slot("s5", "outside")],
    });
    // The order the slots are configured in IS the order they take in the grid
    // (Adeline, 2026-09-25): the dials, then the two climate knobs, then the
    // readings. A module's declared region no longer places it.
    expect(items.map((item) => item.kind)).toEqual([
      "lighting",
      "amplifier",
      "climate",
      "climate",
      "outside",
    ]);
  });

  it("uses the instance's own control state and remembered settings", () => {
    const items = build({ presets: [AIRCON], slots: [slot("s", "lounge")] });
    const aircon = items[0];
    expect(aircon.kind).toBe("climate");
    if (aircon.kind === "climate" && aircon.variant === "aircon") {
      expect(aircon.climateControl).toEqual({ dryEmulatable: false });
      expect(aircon.preferences?.temperature).toBe(22);
      expect(aircon.aircon.entity.entity_id).toBe("climate.lounge");
      expect(aircon.aircon.quietSwitch?.entity_id).toBe("switch.lounge_quiet");
    }
  });

  it("draws a preset that inherits into whichever room its slot sits in", () => {
    const bedroom = zone("bedroom", "Bedroom", [entity("light.bedroom_lamp", "on")]);
    const state = { ...STATE, zones: [...STATE.zones, bedroom] } as DashboardState;
    const items = build({ presets: [{ ...LIGHTS, roomId: null }], slots: [slot("s", "home-lights", "bedroom")] }, state);
    expect(items[0].kind).toBe("lighting");
    if (items[0].kind === "lighting") {
      expect(items[0].zone.id).toBe("bedroom");
    }
  });

  it("keeps a lighting preset in its own room even when the slot sits elsewhere", () => {
    const bedroom = zone("bedroom", "Bedroom", [entity("light.bedroom_lamp", "on")]);
    const state = { ...STATE, zones: [...STATE.zones, bedroom] } as DashboardState;
    const items = build({ presets: [LIGHTS], slots: [slot("s", "home-lights", "bedroom")] }, state);
    expect(items[0].kind === "lighting" && items[0].zone.id).toBe("everything");
  });

  it("drops a climate slot whose device cannot be found rather than drawing an empty knob", () => {
    const empty = zone("climate", "Climate", []);
    const state = { ...STATE, zones: [empty, HOME_ZONE] } as DashboardState;
    expect(build({ presets: [AIRCON], slots: [slot("s", "lounge")] }, state)).toEqual([]);
  });

  it("drops a lighting slot whose room is not a zone at all", () => {
    expect(build({ presets: [{ ...LIGHTS, roomId: "nowhere" }], slots: [slot("s", "home-lights")] })).toEqual([]);
  });
});
