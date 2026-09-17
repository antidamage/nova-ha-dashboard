import type { DashboardLightingConfig, LightingIntensityThreshold, ZoneLightEvent } from "../types";
import type { LightEntityPreset } from "../lighting-presets";
import { defaultZoneRules } from "./rules-model";
import type { RuleZone, ZoneLightRule } from "./types";

function ruleToEvent(rule: Extract<ZoneLightRule, { kind: "event" }>): ZoneLightEvent {
  return {
    id: rule.id,
    zoneId: rule.zoneId,
    ...(rule.name ? { name: rule.name } : {}),
    enabled: rule.enabled,
    at: rule.at,
    days: rule.days,
    value: rule.value,
  };
}

/**
 * The lighting config the rest of the lighting layer reads. Threshold, pinned
 * and event rules are projected into `intensityThresholds`, `entityPresets`
 * pinned flags and `zoneEvents`, joined with anything still in the old keys
 * (config not yet migrated), so those consumers behave exactly as before.
 */
export function projectLightingRules<T extends Partial<DashboardLightingConfig>>(lighting: T): T & DashboardLightingConfig {
  const rules = lighting.zoneRules ?? [];
  const thresholds: LightingIntensityThreshold[] = [
    ...(lighting.intensityThresholds ?? []),
    ...rules.flatMap((rule) => rule.kind === "threshold" && rule.enabled
      ? [{ ...(rule.name ? { name: rule.name } : {}), thresholdPct: rule.thresholdPct, entityIds: [...rule.entityIds] }]
      : []),
  ];

  const pinnedIds = new Set(rules.flatMap((rule) => rule.kind === "pinned" && rule.enabled ? rule.entityIds : []));
  const presets: LightEntityPreset[] = (lighting.entityPresets ?? []).map((preset) =>
    pinnedIds.has(preset.entityId.trim()) && !preset.pinned ? { ...preset, pinned: true } : preset);
  const listed = new Set(presets.map((preset) => preset.entityId.trim()));
  for (const entityId of pinnedIds) {
    if (!listed.has(entityId)) presets.push({ entityId, pinned: true });
  }

  const eventIds = new Set((lighting.zoneEvents ?? []).map((event) => event.id));
  const events: ZoneLightEvent[] = [
    ...(lighting.zoneEvents ?? []),
    ...rules.flatMap((rule) => rule.kind === "event" && !eventIds.has(rule.id) ? [ruleToEvent(rule)] : []),
  ];

  return {
    ...lighting,
    intensityThresholds: thresholds,
    entityPresets: presets,
    zoneEvents: events,
    eventSwitchOnEntityIds: lighting.eventSwitchOnEntityIds ?? [],
    zoneRules: rules,
    zoneRulesSeededZoneIds: lighting.zoneRulesSeededZoneIds ?? [],
  };
}

function specificZonesFor(zones: RuleZone[], entityId: string) {
  const holding = zones.filter((zone) => zone.entities.some((entity) => entity.entity_id === entityId));
  const specific = holding.filter((zone) => zone.id !== "everything" && !zone.special);
  return specific.length ? specific : holding;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function lightingZones(zones: RuleZone[]) {
  return zones.filter((zone) => !zone.special && zone.entities.some((entity) => entity.domain === "light"));
}

/**
 * Fold the old per-automation keys into rules, and seed each lighting zone
 * with the Adaptive and White presets it had as buttons. Idempotent: a second
 * run on its own output reports no change. Needs the zones, so it runs on the
 * host; with no zones known it changes nothing and is tried again later.
 *
 * `preferences.lighting.adaptiveCandlelightZones` keeps only runtime state
 * (whether the zone is currently following, and the last sun state it was
 * moved for). Whether a zone takes part at all is its adaptive rule, seeded
 * enabled for every lighting zone, which is what every zone had before.
 */
export function migrateLightingRules(
  lighting: Partial<DashboardLightingConfig>,
  zones: RuleZone[],
): { changed: boolean; lighting: DashboardLightingConfig } {
  const base = {
    ...lighting,
    intensityThresholds: lighting.intensityThresholds ?? [],
    entityPresets: lighting.entityPresets ?? [],
    zoneEvents: lighting.zoneEvents ?? [],
    eventSwitchOnEntityIds: lighting.eventSwitchOnEntityIds ?? [],
    zoneRules: lighting.zoneRules ?? [],
    zoneRulesSeededZoneIds: lighting.zoneRulesSeededZoneIds ?? [],
  } as DashboardLightingConfig;
  if (!zones.length) return { changed: false, lighting: base };

  const rules: ZoneLightRule[] = [...(base.zoneRules ?? [])];
  const ids = new Set(rules.map((rule) => rule.id));
  const add = (rule: ZoneLightRule) => {
    if (ids.has(rule.id)) return false;
    ids.add(rule.id);
    rules.push(rule);
    return true;
  };
  let changed = false;
  const fallbackZoneId = (zones.find((zone) => zone.id === "everything") ?? zones[0]).id;

  for (const event of base.zoneEvents ?? []) {
    add({ ...event, kind: "event" });
    changed = true;
  }

  (base.intensityThresholds ?? []).forEach((threshold, index) => {
    const zoneId = threshold.entityIds.map((entityId) => specificZonesFor(zones, entityId)[0]?.id).find(Boolean) ?? fallbackZoneId;
    add({
      id: `threshold-${slug(threshold.name ?? "") || index + 1}`,
      zoneId,
      ...(threshold.name ? { name: threshold.name } : {}),
      enabled: true,
      kind: "threshold",
      thresholdPct: threshold.thresholdPct,
      entityIds: [...threshold.entityIds],
    });
    changed = true;
  });

  const pinnedByZone = new Map<string, string[]>();
  for (const preset of base.entityPresets ?? []) {
    if (!preset.pinned) continue;
    const entityId = preset.entityId.trim();
    const zoneId = specificZonesFor(zones, entityId)[0]?.id ?? fallbackZoneId;
    pinnedByZone.set(zoneId, [...(pinnedByZone.get(zoneId) ?? []), entityId]);
    changed = true;
  }
  for (const [zoneId, entityIds] of pinnedByZone) {
    const existing = rules.find((rule) => rule.id === `pinned-${zoneId}`);
    if (existing?.kind === "pinned") {
      existing.entityIds = [...new Set([...existing.entityIds, ...entityIds])];
    } else {
      add({ id: `pinned-${zoneId}`, zoneId, name: "Pinned", enabled: true, kind: "pinned", entityIds });
    }
  }

  const seeded = [...(base.zoneRulesSeededZoneIds ?? [])];
  for (const zone of lightingZones(zones)) {
    if (seeded.includes(zone.id)) continue;
    for (const rule of defaultZoneRules(zone.id)) add(rule);
    seeded.push(zone.id);
    changed = true;
  }

  if (!changed) return { changed: false, lighting: base };

  return {
    changed: true,
    lighting: {
      ...base,
      intensityThresholds: [],
      zoneEvents: [],
      entityPresets: (base.entityPresets ?? []).map((preset) => {
        if (!("pinned" in preset)) return preset;
        const { pinned: _pinned, ...rest } = preset;
        return rest;
      }),
      zoneRules: rules,
      zoneRulesSeededZoneIds: seeded,
    },
  };
}
