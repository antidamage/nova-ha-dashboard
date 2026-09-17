import type { ReminderGlyph } from "../reminder-glyph";
import type { ZoneLightEventTime } from "../types";

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

export type RuleOperationResult =
  | { ok: true; store: ZoneLightRuleStore; rule?: ZoneLightRule }
  | { ok: false; status: number; error: string };

export type RuleTrigger =
  | { kind: "zone"; action: "on" | "off" | "candlelight" | "white" | "color"; brightnessPct?: number; rgb?: [number, number, number]; cursor?: { x: number; y: number } }
  | { kind: "host"; automation: "threshold" | "pinned" };
