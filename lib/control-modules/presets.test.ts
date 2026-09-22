import { describe, expect, it } from "vitest";
import { airconInstances, heaterInstances } from "../climate-instances";
import { resolveFeatures } from "./catalogue";
import { effectiveControls, effectivePresets, presetProblems } from "./presets";
import { CONTROL_MODULES } from "./catalogue";

/**
 * The preset model's contract (specs/control-modules.md).
 *
 * The load-bearing claim is the first one: a home that has stored nothing gets
 * exactly the controls it had before presets existed, derived from the config it
 * already had. Everything else in this file is about what happens once somebody
 * saves something.
 */

const MODULES = CONTROL_MODULES;

/**
 * Only the blocks the derivation reads. Cast rather than built: a whole
 * DashboardConfig here would be a second copy of the schema to keep in step.
 */
type PartialConfig = Parameters<typeof effectiveControls>[0];

const LEGACY = {
  dashboard: {
    aircon: { matchTokens: ["gree", "c6780cad"], offTimerIncrementMinutes: 30, title: "Lounge" },
    bedroomHeater: {
      humidityEntityIds: ["sensor.bedroom_heater_humidity"],
      switchEntityIds: ["switch.bedroom_heater", "switch.tuya_mobile_bedroom_heater"],
      temperatureEntityIds: ["sensor.tuya_mobile_bedroom_sensor_temperature"],
      title: "Bedroom",
    },
    climate: { airconUnits: [], heaters: [] },
    controls: { presets: [], slots: [] },
  },
} as unknown as PartialConfig;

const DECLARED = {
  dashboard: {
    ...LEGACY.dashboard,
    climate: {
      airconUnits: [
        { id: "studio", matchTokens: ["daikin"], temperatureEntityIds: [], title: "Studio", zoneId: "studio" },
      ],
      heaters: [
        { id: "office", switchEntityIds: ["switch.office_heater"], temperatureEntityIds: [], humidityEntityIds: [], title: "Office" },
      ],
    },
  },
} as unknown as PartialConfig;

describe("derived presets", () => {
  it("turns the legacy single-device config into one preset each, under the same ids", () => {
    const presets = effectivePresets(LEGACY);
    const aircon = presets.find((preset) => preset.variant === "aircon");
    const heater = presets.find((preset) => preset.variant === "heater");
    // The id IS the instance key for control state and remembered settings, so
    // adopting the derivation must not move a heater's saved target.
    expect(aircon?.id).toBe("lounge");
    expect(heater?.id).toBe("bedroom");
    expect(aircon?.driverId).toBe("gree-air-conditioner");
    expect(heater?.driverId).toBe("sample-heater-wifi-switch");
    expect(aircon?.name).toBe("Lounge");
    expect(heater?.binding.switchEntityIds).toEqual(["switch.bedroom_heater", "switch.tuya_mobile_bedroom_heater"]);
  });

  it("covers the card's other three segments", () => {
    const ids = effectivePresets(LEGACY).map((preset) => preset.id);
    expect(ids).toEqual(["lounge", "bedroom", "home-lights", "amplifier", "outside"]);
  });

  it("reads declared instances, and their rooms, in preference to the legacy blocks", () => {
    expect(airconInstances(DECLARED).map((instance) => instance.id)).toEqual(["studio"]);
    expect(heaterInstances(DECLARED).map((instance) => instance.id)).toEqual(["office"]);
    expect(effectivePresets(DECLARED).find((preset) => preset.id === "studio")?.roomId).toBe("studio");
  });
});

describe("stored presets", () => {
  const stored = {
    dashboard: {
      ...LEGACY.dashboard,
      controls: {
        configured: true,
        presets: [
          { id: "study", moduleId: "aircon-heater-control", name: "Study", roomId: "study", driverId: "gree-air-conditioner", variant: "aircon", features: {}, binding: { matchTokens: ["daikin"] } },
        ],
        slots: [{ id: "s1", presetId: "study", roomId: null, surface: "quick-access", visible: true }],
      },
    },
  } as unknown as PartialConfig;

  it("wins outright, including when it declares fewer devices than the config does", () => {
    // "This home has no heater" is an answer, not an absence — deriving alongside
    // a stored list would be two answers to which heater the bedroom card shows.
    expect(effectivePresets(stored).map((preset) => preset.id)).toEqual(["study"]);
    expect(heaterInstances(stored)).toEqual([]);
    expect(airconInstances(stored).map((instance) => instance.id)).toEqual(["study"]);
  });

  it("carries a preset's room onto its climate instance, so a control lands in its own zone panel", () => {
    expect(airconInstances(stored)[0].zoneId).toBe("study");
  });
});

describe("preset problems", () => {
  it("refuses an unknown module and an unassigned driver, but only warns about a missing device", () => {
    const problems = presetProblems(
      [
        { id: "a", moduleId: "aircon-heater-control", name: "A", roomId: null, driverId: null, variant: "aircon", features: {}, binding: {} },
        { id: "b", moduleId: "not-installed", name: "B", roomId: null, driverId: null, variant: null, features: {}, binding: {} },
      ],
      MODULES,
    );
    const errors = problems.filter((problem) => problem.severity === "error").map((problem) => problem.field).sort();
    expect(errors).toEqual(["driverId", "moduleId"]);
    // The switch list is the one field a driver cannot work without.
    expect(problems.filter((problem) => problem.severity === "warning").map((problem) => problem.field)).not.toContain("switchEntityIds");
  });

  it("warns — not errors — when a heater has no switch bound yet", () => {
    const problems = presetProblems(
      [{ id: "h", moduleId: "aircon-heater-control", name: "H", roomId: null, driverId: "sample-heater-wifi-switch", variant: "heater", features: {}, binding: {} }],
      MODULES,
    );
    expect(problems).toEqual([
      { field: "switchEntityIds", message: "No switch entities yet", presetId: "h", severity: "warning" },
    ]);
  });

  it("reports two presets sharing an id, because one of them is invisible", () => {
    const base = { moduleId: "outside-weather", name: "Outside", roomId: null, driverId: null, variant: null, features: {}, binding: {} };
    const problems = presetProblems(
      [{ id: "dup", ...base }, { id: "dup", ...base }],
      MODULES,
    );
    expect(problems.some((problem) => problem.message.includes("share this id"))).toBe(true);
  });
});

describe("the configured flag", () => {
  it("keeps a deliberately emptied card empty, instead of deriving over it", () => {
    const emptied = {
      dashboard: {
        ...LEGACY.dashboard,
        controls: { configured: true, presets: [], slots: [] },
      },
    } as unknown as PartialConfig;
    // No presets, but the owner HAS saved: deriving here would resurrect every
    // control she just removed.
    expect(effectivePresets(emptied)).toEqual([]);
    expect(effectiveControls(emptied).slots).toEqual([]);
    expect(heaterInstances(emptied)).toEqual([]);
  });

  it("still derives when the block has never been saved", () => {
    const untouched = {
      dashboard: { ...LEGACY.dashboard, controls: { presets: [], slots: [] } },
    } as unknown as PartialConfig;
    expect(effectivePresets(untouched).length).toBe(5);
  });
});

describe("feature gates", () => {
  it("offers the fan ring only where there is a fan, and the sensor list only where it is read", () => {
    const module = CONTROL_MODULES.find((candidate) => candidate.id === "aircon-heater-control")!;
    const aircon = resolveFeatures(module, { driverId: "gree-air-conditioner", features: {}, variant: "aircon" });
    const heater = resolveFeatures(module, { driverId: "sample-heater-wifi-switch", features: {}, variant: "heater" });
    // A feature that does not apply carries no value at all, so no consumer can
    // read a default as "on" for a control that has no such part.
    expect(aircon["fan-ring"]).toBe(true);
    expect("grouped-room-sensors" in aircon).toBe(false);
    expect(heater["grouped-room-sensors"]).toBe(true);
    expect("fan-ring" in heater).toBe(false);
  });
});

describe("effectiveControls", () => {
  it("derives both halves from the config when nothing is stored", () => {
    const controls = effectiveControls(LEGACY);
    expect(controls.slots.map((slot) => slot.presetId)).toEqual(["home-lights", "amplifier", "lounge", "bedroom", "outside"]);
    expect(controls.slots.every((slot) => slot.surface === "quick-access")).toBe(true);
  });
});
