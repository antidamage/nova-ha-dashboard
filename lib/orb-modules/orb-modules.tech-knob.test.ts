import { describe, expect, it } from "vitest";
import { orbLayerGateOpen, orbResolvedSettingId, resolveOrbModuleSettings } from "../orb-modules";
import { asDark, asLight } from "./orb-modules.settings.fixtures";
import { TECH_MODULE } from "./tech.data";

describe("the Tech module's two knob treatments", () => {
  /** Does this layer paint any part of itself from a theme slot? */
  function usesThemeSlot(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(usesThemeSlot);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.theme === "string") return true;
      return Object.values(record).some(usesThemeSlot);
    }
    return false;
  }

  it("paints a treatment from its own colours, never from the theme's", () => {
    // A treatment that inherits the page is not the treatment it was set to.
    // The dark dome read its stops from the theme's gradient slots, which on a
    // LIGHT theme are white — so Dark drew a white knob there and Light and
    // Dark were the same orb. The knob's own CSS had already fixed this class
    // of bug by giving both skins a fixed face colour (see its "The two skins
    // each name their own face colour" note); the orb's dark layers were left
    // behind. This pins that no treatment layer goes back to a theme slot.
    const treatmentLayers = TECH_MODULE.layers.filter(
      (layer) => layer.enabledWhen?.setting === "knobThemeResolved",
    );
    expect(treatmentLayers.length).toBeGreaterThan(0);
    expect(treatmentLayers.filter(usesThemeSlot).map((layer) => layer.id)).toEqual([]);
  });

  it("keeps both treatments equally able to draw on any theme", () => {
    // Guards the other half: a pair must exist for each surface, so neither
    // treatment can go missing and leave the other drawing on every theme.
    const ids = TECH_MODULE.layers.map((layer) => layer.id ?? "");
    const dark = ids.filter((id) => id.endsWith("-dark"));
    const light = ids.filter((id) => id.endsWith("-light"));
    expect(dark.length).toBe(light.length);
    expect(dark.map((id) => id.replace(/-dark$/, "")).sort())
      .toEqual(light.map((id) => id.replace(/-light$/, "")).sort());
  });
});

describe("the Tech module's knob theme", () => {
  const decl = TECH_MODULE.settings![0];

  it("is a light/auto/dark choice, defaulting to auto", () => {
    expect(decl.id).toBe("knobTheme");
    // The label is a light/dark selector's, not "Knob Theme" — that name
    // belongs to the control that skins every dial, and this one sits directly
    // beneath it (config/accent/OrbKnobToneControl).
    expect(decl.label).toBe("Orb Knob Tone");
    expect(decl.options).toEqual(["Light", "Auto", "Dark"]);
    expect(decl.default).toBe(1);
  });

  it("gates every paired layer on the resolved id, never the raw stop", () => {
    const gates = TECH_MODULE.layers
      .map((layer) => layer.enabledWhen?.setting)
      .filter((setting): setting is string => setting !== undefined);
    expect(gates.length).toBeGreaterThan(0);
    expect(new Set(gates)).toEqual(new Set(["knobThemeResolved"]));
  });

  it("draws exactly one treatment of every paired surface", () => {
    for (const [stop, treatment] of [[0, asLight], [1, asLight], [1, asDark], [2, asDark]] as const) {
      const settings = resolveOrbModuleSettings(TECH_MODULE, { knobTheme: stop }, treatment);
      // The two gate bounds are a partition: every layer either draws or not,
      // and each paired surface contributes exactly one drawn half.
      const openLayers = TECH_MODULE.layers.filter((layer) => orbLayerGateOpen(layer.enabledWhen, settings));
      const closed = TECH_MODULE.layers.filter((layer) => !orbLayerGateOpen(layer.enabledWhen, settings));
      expect(openLayers.length + closed.length).toBe(TECH_MODULE.layers.length);
      const ungated = TECH_MODULE.layers.filter((layer) => layer.enabledWhen === undefined);
      expect(ungated.every((layer) => orbLayerGateOpen(layer.enabledWhen, settings))).toBe(true);
    }
  });

  it("keeps a theme saved with the old boolean light setting", () => {
    const legacyLight = resolveOrbModuleSettings(TECH_MODULE, { light: 1 }, asDark);
    const legacyDark = resolveOrbModuleSettings(TECH_MODULE, { light: 0 }, asDark);
    expect(legacyLight.knobTheme).toBe(0);
    expect(legacyLight[orbResolvedSettingId("knobTheme")]).toBe(1);
    expect(legacyDark.knobTheme).toBe(2);
    expect(legacyDark[orbResolvedSettingId("knobTheme")]).toBe(0);
  });

  it("lets today's value win over the stored history", () => {
    const resolved = resolveOrbModuleSettings(TECH_MODULE, { knobTheme: 0, light: 0 }, asDark);
    expect(resolved.knobTheme).toBe(0);
  });

  it("leaves an unrelated saved id untouched", () => {
    const given = { knobTheme: 2, chaos: 50 };
    expect(resolveOrbModuleSettings(TECH_MODULE, given, asDark).chaos).toBeUndefined();
  });
});
