import { hsvToRgb } from "../../app/components/colorEncoderModel";
import type { DashboardLightingConfig } from "../types";
import type {
  RuleOperationResult,
  RuleTrigger,
  ZoneLightRule,
  ZoneLightRuleKind,
  ZoneLightRuleStore,
  ZoneLightRuleValue,
} from "./types";

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
