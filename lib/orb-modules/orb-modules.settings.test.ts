import { describe, expect, it } from "vitest";
import {
  normalizeOrbModule,
  orbLayerGateOpen,
  orbResolvedSettingId,
  resolveOrbChoiceTreatment,
  resolveOrbChoiceValue,
  resolveOrbModuleSettings,
  type OrbModule,
} from "../orb-modules";
import { TECH_MODULE } from "./tech.data";

/** A three-stop choice in the Tech module's own shape, for focused assertions. */
const CHOICE_MODULE = normalizeOrbModule({
  id: "choice",
  name: "Choice",
  formatVersion: 1,
  settings: [
    {
      id: "knobTheme",
      label: "Knob Theme",
      min: 0,
      max: 2,
      step: 1,
      default: 1,
      options: ["light", "auto", "dark"],
    },
  ],
  layers: [
    { id: "dark", type: "disc", enabledWhen: { setting: "knobThemeResolved", max: 0.5 }, stops: [{ at: 0, color: { hex: "#000000" } }] },
    { id: "light", type: "disc", enabledWhen: { setting: "knobThemeResolved", min: 0.5 }, stops: [{ at: 0, color: { hex: "#ffffff" } }] },
  ],
}) as OrbModule;

/** The device answer the orb defers to on `auto`, as an option index. */
const asLight = () => 0;
const asDark = () => 2;

describe("choice settings", () => {
  it("keeps the stop labels when they line up with min..max", () => {
    expect(CHOICE_MODULE.settings?.[0].options).toEqual(["light", "auto", "dark"]);
  });

  it("drops a stop list that does not line up with min..max", () => {
    // Three labels over a two-stop range would caption one stop with another
    // stop's name, so the setting stays a magnitude instead.
    const module = normalizeOrbModule({
      id: "mismatch",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
      settings: [{ id: "k", label: "K", min: 0, max: 1, step: 1, default: 0, options: ["light", "auto", "dark"] }],
    });
    expect(module?.settings?.[0].options).toBeUndefined();
  });

  it("publishes the resolved treatment under <id>Resolved, not the raw stop", () => {
    const light = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 0 }, asLight);
    const dark = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 2 }, asDark);
    // The flag is 1 = light / 0 = dark whichever way round the stops are named,
    // so a gate never has to know the slider's order.
    expect(light[orbResolvedSettingId("knobTheme")]).toBe(1);
    expect(dark[orbResolvedSettingId("knobTheme")]).toBe(0);
    // The stop the user picked is still published unchanged for the control.
    expect(light.knobTheme).toBe(0);
    expect(dark.knobTheme).toBe(2);
  });

  it("resolves an auto stop through the device's answer", () => {
    const lightAuto = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 1 }, asLight);
    const darkAuto = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 1 }, asDark);
    expect(lightAuto[orbResolvedSettingId("knobTheme")]).toBe(1);
    expect(darkAuto[orbResolvedSettingId("knobTheme")]).toBe(0);
  });

  it("falls back to the declared default when nothing answers auto", () => {
    const resolved = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 1 });
    // The declared default is 1 (auto) itself, which cannot answer itself, so
    // the choice resolves to the first stop rather than looping.
    expect(resolved.knobTheme).toBe(1);
    expect(resolved[orbResolvedSettingId("knobTheme")]).toBe(1);
  });

  it("gates exactly one treatment of a pair whichever way it resolved", () => {
    const open = (settings: Record<string, number>) =>
      CHOICE_MODULE.layers.filter((layer) => orbLayerGateOpen(layer.enabledWhen, settings));
    for (const treatment of [asLight, asDark]) {
      const settings = resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 1 }, treatment);
      expect(open(settings)).toHaveLength(1);
    }
  });

  it("leaves an ordinary magnitude setting alone", () => {
    const module = normalizeOrbModule({
      id: "mag",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
      settings: [{ id: "chaos", label: "Chaos", min: 0, max: 100, step: 1, default: 30 }],
    }) as OrbModule;
    const settings = resolveOrbModuleSettings(module, { chaos: 73 });
    expect(settings.chaos).toBe(73);
    expect(settings[orbResolvedSettingId("chaos")]).toBeUndefined();
  });

  it("clamps a saved stop into the declared range", () => {
    expect(resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: 99 }, asLight).knobTheme).toBe(2);
    expect(resolveOrbModuleSettings(CHOICE_MODULE, { knobTheme: -5 }, asLight).knobTheme).toBe(0);
  });
});

describe("resolveOrbChoiceValue / resolveOrbChoiceTreatment", () => {
  const decl = CHOICE_MODULE.settings![0];

  it("resolves a pinned stop to itself and auto to the device's index", () => {
    expect(resolveOrbChoiceValue(decl, 0, asLight)).toBe(0);
    expect(resolveOrbChoiceValue(decl, 2, asDark)).toBe(2);
    expect(resolveOrbChoiceValue(decl, 1, asDark)).toBe(2);
    expect(resolveOrbChoiceValue(decl, 1, asLight)).toBe(0);
  });

  it("matches the auto and treatment stops whatever their case", () => {
    // The stop names are user-facing labels, so a module may write them in any
    // case; the resolver must still find them.
    const titleCase = {
      ...decl,
      options: ["Light", "Auto", "Dark"],
      default: 1,
    };
    expect(resolveOrbChoiceValue(titleCase, 1, asDark)).toBe(2);
    expect(resolveOrbChoiceTreatment(titleCase, 2, asLight)).toBe(0);
    expect(resolveOrbChoiceTreatment(titleCase, 0, asDark)).toBe(1);
  });

  it("maps an option index onto a stop's value, not the index itself", () => {
    // min 10, step 10: index 0 sits at 10 and index 2 at 30. Treating the
    // resolver's index as a value would land the dark answer on 10 (the light
    // stop), which is the bug this shape exists to catch.
    const stepped = { ...decl, min: 10, max: 30, step: 10, default: 20 };
    // Pinned stops read as themselves, so the resolver is never consulted.
    expect(resolveOrbChoiceTreatment(stepped, 30, asLight)).toBe(0);
    expect(resolveOrbChoiceTreatment(stepped, 10, asDark)).toBe(1);
    // The auto stop (value 20) resolves through the resolver's index.
    expect(resolveOrbChoiceValue(stepped, 20, asDark)).toBe(30);
    expect(resolveOrbChoiceValue(stepped, 20, asLight)).toBe(10);
  });

  it("never falls back onto the auto stop itself", () => {
    // min 10, step 10, and a declared default that IS the auto stop (value 20).
    // Answering `auto` with `auto` would leave the gates reading a stop that
    // means "ask the device", so the fallback is the first concrete stop. The
    // 0/step-1 shape the rest of these cases use hides this, because there the
    // default and the stop index happen to be the same number.
    const stepped = {
      ...decl,
      min: 10,
      max: 30,
      step: 10,
      default: 20,
      options: ["Light", "Auto", "Dark"],
    };
    // No device answer at all.
    expect(resolveOrbChoiceValue(stepped, 20)).toBe(10);
    expect(resolveOrbChoiceTreatment(stepped, 20)).toBe(1);
    // A resolver that answers with the auto stop has not answered either.
    expect(resolveOrbChoiceValue(stepped, 20, () => 1)).toBe(10);
    // A concrete declared default is still honoured over the first stop.
    expect(resolveOrbChoiceValue({ ...stepped, default: 30 }, 20)).toBe(30);
  });

  it("publishes a choice that names neither treatment by its own value", () => {
    const flavours = normalizeOrbModule({
      id: "flavours",
      layers: [{ type: "ring", radius: 1, width: 0.1, color: { theme: "line1" } }],
      settings: [{ id: "f", label: "F", min: 0, max: 1, step: 1, default: 0, options: ["calm", "busy"] }],
    }) as OrbModule;
    const settings = resolveOrbModuleSettings(flavours, { f: 1 }, asLight);
    expect(settings[orbResolvedSettingId("f")]).toBe(1);
  });
});

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
