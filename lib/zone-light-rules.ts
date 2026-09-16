import { hsvToRgb } from "../app/components/colorEncoderModel";
import type { ReminderGlyph } from "./reminder-glyph";
import type {
  DashboardLightingConfig,
  LightingIntensityThreshold,
  ZoneLightEvent,
  ZoneLightEventTime,
} from "./types";
import type { LightEntityPreset } from "./lighting-presets";

/**
 * Every lighting automation for a zone is a rule in
 * `dashboard.lighting.zoneRules` (specs/zone-light-events.md, round 2). This
 * module is pure: the rule shapes, the built-in On/Off presets, the migration
 * from the old per-automation keys, the projection back into the shapes the
 * lighting layer already consumes, and the list operations the API and the
 * demo store share.
 */

export type ZoneLightRuleValue = { hue: number; saturation: number; brightnessPct: number };

export type ZoneLightRulePreset = {
  show: boolean;
  icon?: ReminderGlyph;
  order: number;
};

type RuleBase = {
  id: string;
  zoneId: string;
  name?: string;
  enabled: boolean;
  preset?: ZoneLightRulePreset;
};

export type ZoneLightRule =
  | (RuleBase & { kind: "event"; at: ZoneLightEventTime; days: number[]; value: ZoneLightRuleValue })
  | (RuleBase & { kind: "adaptive" })
  | (RuleBase & { kind: "threshold"; thresholdPct: number; entityIds: string[] })
  | (RuleBase & { kind: "pinned"; entityIds: string[] })
  | (RuleBase & { kind: "preset"; value: ZoneLightRuleValue; builtin?: "on" | "off" });

export type ZoneLightRuleKind = ZoneLightRule["kind"];

export type ZoneLightRuleStore = {
  rules: ZoneLightRule[];
  seededZoneIds: string[];
};

/** A zone as far as migration needs one. */
export type RuleZone = {
  id: string;
  special?: string;
  entities: Array<{ entity_id: string; domain: string }>;
};

export const WHITE_RULE_VALUE: ZoneLightRuleValue = { hue: 0, saturation: 0, brightnessPct: 100 };
const BUILTIN_PREFIX = { on: "builtin-on:", off: "builtin-off:" } as const;

export function builtinRuleId(builtin: "on" | "off", zoneId: string) {
  return `${BUILTIN_PREFIX[builtin]}${zoneId}`;
}

export function isBuiltinRuleId(id: string) {
  return id.startsWith(BUILTIN_PREFIX.on) || id.startsWith(BUILTIN_PREFIX.off);
}

/** On and Off exist for every lighting zone and are never stored. */
export function builtinRules(zoneId: string): ZoneLightRule[] {
  return (["on", "off"] as const).map((builtin) => ({
    id: builtinRuleId(builtin, zoneId),
    zoneId,
    name: builtin === "on" ? "On" : "Off",
    enabled: true,
    kind: "preset",
    builtin,
    value: builtin === "on" ? { hue: 0, saturation: 0, brightnessPct: 100 } : { hue: 0, saturation: 0, brightnessPct: 0 },
    preset: { show: true, order: builtin === "on" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY },
  }));
}

/** The Adaptive and White buttons every zone had before rules; removable. */
export function defaultZoneRules(zoneId: string): ZoneLightRule[] {
  return [
    { id: `adaptive-${zoneId}`, zoneId, name: "Adaptive", enabled: true, kind: "adaptive", preset: { show: true, order: 1 } },
    { id: `white-${zoneId}`, zoneId, name: "White", enabled: true, kind: "preset", value: { ...WHITE_RULE_VALUE }, preset: { show: true, order: 2 } },
  ];
}

export function storeFromLighting(lighting?: Partial<DashboardLightingConfig> | null): ZoneLightRuleStore {
  return {
    rules: [...(lighting?.zoneRules ?? [])],
    seededZoneIds: [...(lighting?.zoneRulesSeededZoneIds ?? [])],
  };
}

/** Stored rules for a zone, plus the defaults it has not been seeded with yet. */
function storedOrDefaultRules(store: ZoneLightRuleStore, zoneId: string) {
  const stored = store.rules.filter((rule) => rule.zoneId === zoneId);
  if (store.seededZoneIds.includes(zoneId)) return stored;
  const ids = new Set(stored.map((rule) => rule.id));
  return [...stored, ...defaultZoneRules(zoneId).filter((rule) => !ids.has(rule.id))];
}

/** Every rule the zone's section lists: On, the zone's rules, Off. */
export function effectiveZoneRules(store: ZoneLightRuleStore, zoneId: string): ZoneLightRule[] {
  const [on, off] = builtinRules(zoneId);
  return [on, ...storedOrDefaultRules(store, zoneId), off];
}

/** The default-view row: On first, shown custom presets in order, Off last. */
export function presetRowRules(store: ZoneLightRuleStore, zoneId: string): ZoneLightRule[] {
  const [on, off] = builtinRules(zoneId);
  const custom = storedOrDefaultRules(store, zoneId)
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.preset?.show)
    .sort((left, right) => (left.rule.preset!.order - right.rule.preset!.order) || left.index - right.index)
    .map(({ rule }) => rule);
  return [on, ...custom, off];
}

/** Whether the zone follows adaptive candlelight at sun crossings. */
export function adaptiveRuleEnabled(lighting: Partial<DashboardLightingConfig> | null | undefined, zoneId: string) {
  return storedOrDefaultRules(storeFromLighting(lighting), zoneId)
    .some((rule) => rule.kind === "adaptive" && rule.enabled);
}

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

export type RuleOperationResult =
  | { ok: true; store: ZoneLightRuleStore; rule?: ZoneLightRule }
  | { ok: false; status: number; error: string };

/** Store the zone's defaults before editing it, so they stop being virtual. */
function materialiseZone(store: ZoneLightRuleStore, zoneId: string): ZoneLightRuleStore {
  if (store.seededZoneIds.includes(zoneId)) return store;
  const ids = new Set(store.rules.map((rule) => rule.id));
  return {
    rules: [...store.rules, ...defaultZoneRules(zoneId).filter((rule) => !ids.has(rule.id))],
    seededZoneIds: [...store.seededZoneIds, zoneId],
  };
}

function nextOrder(store: ZoneLightRuleStore, zoneId: string) {
  return store.rules
    .filter((rule) => rule.zoneId === zoneId)
    .reduce((max, rule) => Math.max(max, rule.preset?.order ?? 0), 0) + 1;
}

export function newRuleId(kind: ZoneLightRuleKind) {
  return `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createRule(store: ZoneLightRuleStore, input: ZoneLightRule): RuleOperationResult {
  if (!input?.zoneId || !input.kind) return { ok: false, status: 400, error: "A rule needs a zoneId and a kind" };
  if ((input as { builtin?: unknown }).builtin) return { ok: false, status: 400, error: "On and Off are built in" };
  const next = materialiseZone(store, input.zoneId);
  const id = input.id && !isBuiltinRuleId(input.id) && !next.rules.some((rule) => rule.id === input.id)
    ? input.id
    : newRuleId(input.kind);
  const rule = {
    ...input,
    id,
    enabled: input.enabled ?? true,
    preset: { show: input.preset?.show ?? false, ...(input.preset?.icon ? { icon: input.preset.icon } : {}), order: nextOrder(next, input.zoneId) },
  } as ZoneLightRule;
  return { ok: true, store: { ...next, rules: [...next.rules, rule] }, rule };
}

export function updateRule(store: ZoneLightRuleStore, id: string, patch: Partial<ZoneLightRule>): RuleOperationResult {
  if (isBuiltinRuleId(id)) return { ok: false, status: 403, error: "On and Off are built in and cannot be changed" };
  const zoneId = storeZoneOf(store, id);
  if (!zoneId) return { ok: false, status: 404, error: `Unknown rule: ${id}` };
  const next = materialiseZone(store, zoneId);
  let updated: ZoneLightRule | undefined;
  const rules = next.rules.map((rule) => {
    if (rule.id !== id) return rule;
    updated = { ...rule, ...patch, id: rule.id, zoneId: rule.zoneId, kind: rule.kind } as ZoneLightRule;
    return updated;
  });
  return { ok: true, store: { ...next, rules }, rule: updated };
}

export function deleteRule(store: ZoneLightRuleStore, id: string): RuleOperationResult {
  if (isBuiltinRuleId(id)) return { ok: false, status: 403, error: "On and Off are built in and cannot be deleted" };
  const zoneId = storeZoneOf(store, id);
  if (!zoneId) return { ok: false, status: 404, error: `Unknown rule: ${id}` };
  const next = materialiseZone(store, zoneId);
  return { ok: true, store: { ...next, rules: next.rules.filter((rule) => rule.id !== id) } };
}

/** Sets preset order from the given id sequence; built-ins are ignored. */
export function reorderRules(store: ZoneLightRuleStore, zoneId: string, orderedIds: string[]): RuleOperationResult {
  const next = materialiseZone(store, zoneId);
  const position = new Map(orderedIds.filter((id) => !isBuiltinRuleId(id)).map((id, index) => [id, index + 1]));
  const rules = next.rules.map((rule) => {
    const order = position.get(rule.id);
    if (rule.zoneId !== zoneId || order === undefined) return rule;
    return { ...rule, preset: { show: rule.preset?.show ?? false, ...(rule.preset?.icon ? { icon: rule.preset.icon } : {}), order } };
  });
  return { ok: true, store: { ...next, rules } };
}

function storeZoneOf(store: ZoneLightRuleStore, id: string) {
  const stored = store.rules.find((rule) => rule.id === id);
  if (stored) return stored.zoneId;
  const match = /^(adaptive|white)-(.+)$/.exec(id);
  return match && !store.seededZoneIds.includes(match[2]) ? match[2] : null;
}

export function findRule(store: ZoneLightRuleStore, id: string): ZoneLightRule | null {
  const builtin = /^builtin-(on|off):(.+)$/.exec(id);
  if (builtin) return builtinRules(builtin[2]).find((rule) => rule.id === id) ?? null;
  const zoneId = storeZoneOf(store, id);
  return zoneId ? storedOrDefaultRules(store, zoneId).find((rule) => rule.id === id) ?? null : null;
}

export type RuleTrigger =
  | { kind: "zone"; action: "on" | "off" | "candlelight" | "white" | "color"; brightnessPct?: number; rgb?: [number, number, number]; cursor?: { x: number; y: number } }
  | { kind: "host"; automation: "threshold" | "pinned" };

/**
 * What pressing a rule's preset does now. Value rules go through the zone
 * command path so pinned lights and thresholds apply exactly as for a dial
 * set; adaptive is the current adaptive value; threshold and pinned rules run
 * their own host pass once.
 */
export function ruleTrigger(rule: ZoneLightRule): RuleTrigger {
  if (rule.kind === "threshold" || rule.kind === "pinned") return { kind: "host", automation: rule.kind };
  if (rule.kind === "adaptive") return { kind: "zone", action: "candlelight" };
  if (rule.kind === "preset" && rule.builtin) return { kind: "zone", action: rule.builtin };
  const { hue, saturation, brightnessPct } = rule.value;
  if (brightnessPct <= 0) return { kind: "zone", action: "off" };
  if (saturation === 0 && brightnessPct === 100) return { kind: "zone", action: "white", brightnessPct: 100 };
  return {
    kind: "zone",
    action: "color",
    brightnessPct,
    rgb: hsvToRgb(hue, saturation, 100),
    cursor: { x: hue / 359, y: 1 - saturation / 100 },
  };
}
