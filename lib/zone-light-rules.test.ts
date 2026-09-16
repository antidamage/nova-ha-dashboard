import { describe, expect, it } from "vitest";
import { dueOccurrence } from "./light-events";
import type { DashboardLightingConfig } from "./types";
import {
  adaptiveRuleEnabled,
  builtinRuleId,
  createRule,
  deleteRule,
  effectiveZoneRules,
  findRule,
  migrateLightingRules,
  presetRowRules,
  projectLightingRules,
  reorderRules,
  ruleTrigger,
  storeFromLighting,
  updateRule,
  type RuleZone,
} from "./zone-light-rules";

const zones: RuleZone[] = [
  { id: "everything", entities: [{ entity_id: "light.lamp_a", domain: "light" }, { entity_id: "light.lamp_b", domain: "light" }, { entity_id: "light.spare", domain: "light" }] },
  { id: "den", entities: [{ entity_id: "light.lamp_a", domain: "light" }] },
  { id: "porch", entities: [{ entity_id: "light.lamp_b", domain: "light" }, { entity_id: "light.spare", domain: "light" }] },
  { id: "climate", special: "climate", entities: [{ entity_id: "switch.fan", domain: "switch" }] },
];

const legacy: DashboardLightingConfig = {
  intensityThresholds: [{ name: "Strip", thresholdPct: 61, entityIds: ["light.lamp_a", "light.not_in_a_zone"] }],
  entityPresets: [
    { entityId: "light.lamp_b", pinned: true, targetBrightnessPct: { daytime: 100, evening: 100 }, colorTemperatureOverrideKelvin: { candlelight: 3000, daylight: 3000 } },
    { entityId: "light.spare", targetBrightnessPct: { daytime: 80, evening: 40 } },
  ],
  zoneEvents: [{ id: "evt-1", zoneId: "den", enabled: true, at: { kind: "sun", event: "sunset", offsetMinutes: -30 }, days: [], value: { hue: 30, saturation: 60, brightnessPct: 60 } }],
  eventSwitchOnEntityIds: ["light.lamp_a"],
};

function comparable(lighting: DashboardLightingConfig) {
  const projected = projectLightingRules(lighting);
  return {
    intensityThresholds: projected.intensityThresholds,
    pinned: (projected.entityPresets ?? []).filter((preset) => preset.pinned).map((preset) => preset.entityId).sort(),
    calibration: (projected.entityPresets ?? []).map(({ pinned: _pinned, ...rest }) => rest),
    zoneEvents: projected.zoneEvents,
    eventSwitchOnEntityIds: projected.eventSwitchOnEntityIds,
  };
}

describe("migrating lighting automations into zone rules", () => {
  const migrated = migrateLightingRules(legacy, zones);

  it("moves every automation into rules and empties the old keys", () => {
    expect(migrated.changed).toBe(true);
    const { lighting } = migrated;
    expect(lighting.intensityThresholds).toEqual([]);
    expect(lighting.zoneEvents).toEqual([]);
    expect(lighting.entityPresets?.some((preset) => "pinned" in preset)).toBe(false);
    const kinds = (lighting.zoneRules ?? []).map((rule) => `${rule.kind}:${rule.zoneId}`);
    expect(kinds).toEqual(expect.arrayContaining([
      "event:den", "threshold:den", "pinned:porch",
      "adaptive:everything", "adaptive:den", "adaptive:porch",
      "preset:everything", "preset:den", "preset:porch",
    ]));
    expect(kinds.some((kind) => kind.endsWith(":climate"))).toBe(false);
    expect(lighting.zoneRulesSeededZoneIds).toEqual(["everything", "den", "porch"]);
  });

  it("projects back to exactly what the lighting layer read before", () => {
    expect(comparable(migrated.lighting)).toEqual(comparable(legacy));
  });

  it("is idempotent", () => {
    const again = migrateLightingRules(migrated.lighting, zones);
    expect(again.changed).toBe(false);
    expect(again.lighting.zoneRules).toEqual(migrated.lighting.zoneRules);
  });

  it("waits for zones rather than guessing", () => {
    expect(migrateLightingRules(legacy, []).changed).toBe(false);
  });

  it("fires timed events on the same occurrences", () => {
    const sun = { entity_id: "sun.sun", state: "above_horizon", nextSetting: "2026-09-15T06:30:00.000Z" } as never;
    for (const minutes of [-10, 0, 1, 4, 6, 60]) {
      const now = new Date(Date.parse("2026-09-15T06:30:00.000Z") + minutes * 60_000);
      const before = legacy.zoneEvents!.map((event) => dueOccurrence(event, now, { sun })?.toISOString() ?? null);
      const after = projectLightingRules(migrated.lighting).zoneEvents!.map((event) => dueOccurrence(event, now, { sun })?.toISOString() ?? null);
      expect(after).toEqual(before);
    }
  });

  it("keeps a disabled threshold or pin out of the projection", () => {
    const rules = (migrated.lighting.zoneRules ?? []).map((rule) =>
      rule.kind === "threshold" || rule.kind === "pinned" ? { ...rule, enabled: false } : rule);
    const projected = projectLightingRules({ ...migrated.lighting, zoneRules: rules });
    expect(projected.intensityThresholds).toEqual([]);
    expect(projected.entityPresets?.some((preset) => preset.pinned)).toBe(false);
  });

  it("passes the config schema, so the host can write it back", async () => {
    const { validateDashboardConfig } = await import("./dashboard-config");
    const defaults = (await import("../config/dashboard-config.default.json")).default as Record<string, unknown>;
    const dashboard = { ...(defaults.dashboard as Record<string, unknown>), lighting: migrated.lighting };
    const result = validateDashboardConfig({ ...defaults, dashboard });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("gates adaptive following on the zone's adaptive rule", () => {
    expect(adaptiveRuleEnabled(legacy, "den")).toBe(true);
    expect(adaptiveRuleEnabled(migrated.lighting, "den")).toBe(true);
    const result = deleteRule(storeFromLighting(migrated.lighting), "adaptive-den");
    if (!result.ok) throw new Error(result.error);
    expect(adaptiveRuleEnabled({ zoneRules: result.store.rules, zoneRulesSeededZoneIds: result.store.seededZoneIds }, "den")).toBe(false);
  });
});

describe("zone rule list operations", () => {
  const empty = { rules: [], seededZoneIds: [] };

  it("lists On first and Off last with the default presets between them", () => {
    expect(presetRowRules(empty, "den").map((rule) => rule.name)).toEqual(["On", "Adaptive", "White", "Off"]);
    expect(effectiveZoneRules(empty, "den")[0].id).toBe(builtinRuleId("on", "den"));
  });

  it("refuses to delete or change On and Off", () => {
    for (const builtin of ["on", "off"] as const) {
      const id = builtinRuleId(builtin, "den");
      expect(deleteRule(empty, id)).toMatchObject({ ok: false, status: 403 });
      expect(updateRule(empty, id, { name: "x" })).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("adds a shown custom preset between the defaults and Off, and reorders it", () => {
    const created = createRule(empty, {
      id: "", zoneId: "den", kind: "preset", enabled: true, name: "Blue",
      value: { hue: 220, saturation: 80, brightnessPct: 50 },
      preset: { show: true, icon: { kind: "phosphor", id: "moon" }, order: 0 },
    });
    if (!created.ok) throw new Error(created.error);
    expect(presetRowRules(created.store, "den").map((rule) => rule.name)).toEqual(["On", "Adaptive", "White", "Blue", "Off"]);
    const reordered = reorderRules(created.store, "den", [created.rule!.id, "white-den", "adaptive-den"]);
    if (!reordered.ok) throw new Error(reordered.error);
    expect(presetRowRules(reordered.store, "den").map((rule) => rule.name)).toEqual(["On", "Blue", "White", "Adaptive", "Off"]);
  });

  it("keeps a deleted default preset deleted", () => {
    const result = deleteRule(empty, "white-den");
    if (!result.ok) throw new Error(result.error);
    expect(presetRowRules(result.store, "den").map((rule) => rule.name)).toEqual(["On", "Adaptive", "Off"]);
  });

  it("finds virtual and built-in rules for triggering", () => {
    expect(findRule(empty, "adaptive-den")?.kind).toBe("adaptive");
    expect(findRule(empty, builtinRuleId("off", "den"))?.name).toBe("Off");
    expect(findRule(empty, "nope")).toBeNull();
  });
});

describe("triggering a rule now", () => {
  const base = { id: "r", zoneId: "den", enabled: true };
  it("maps each kind to the command it applies", () => {
    expect(ruleTrigger(effectiveZoneRules({ rules: [], seededZoneIds: [] }, "den")[0])).toEqual({ kind: "zone", action: "on" });
    expect(ruleTrigger({ ...base, kind: "adaptive" })).toEqual({ kind: "zone", action: "candlelight" });
    expect(ruleTrigger({ ...base, kind: "preset", value: { hue: 0, saturation: 0, brightnessPct: 100 } })).toMatchObject({ action: "white" });
    expect(ruleTrigger({ ...base, kind: "preset", value: { hue: 120, saturation: 100, brightnessPct: 0 } })).toMatchObject({ action: "off" });
    expect(ruleTrigger({ ...base, kind: "preset", value: { hue: 120, saturation: 100, brightnessPct: 40 } }))
      .toMatchObject({ kind: "zone", action: "color", brightnessPct: 40, cursor: { x: 120 / 359, y: 0 } });
    expect(ruleTrigger({ ...base, kind: "threshold", thresholdPct: 50, entityIds: ["light.lamp_a"] })).toEqual({ kind: "host", automation: "threshold" });
    expect(ruleTrigger({ ...base, kind: "pinned", entityIds: ["light.lamp_a"] })).toEqual({ kind: "host", automation: "pinned" });
  });
});
