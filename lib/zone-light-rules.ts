/**
 * Every lighting automation for a zone is a rule in
 * `dashboard.lighting.zoneRules` (specs/zone-light-events.md, round 2). This
 * module is pure: the rule shapes, the built-in On/Off presets, the migration
 * from the old per-automation keys, the projection back into the shapes the
 * lighting layer already consumes, and the list operations the API and the
 * demo store share.
 */

/*
 * Facade. The body lives in lib/zone-light-rules/; this file keeps the import
 * path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   zone-light-rules/types.ts            rule, store, operation-result and
 *                                        trigger shapes (lib/types/lighting.ts
 *                                        imports this directly)
 *   zone-light-rules/rules-model.ts      built-in and default rules, the
 *                                        section/preset-row views, list
 *                                        operations, ruleTrigger
 *   zone-light-rules/migration-model.ts  projection into the lighting layer's
 *                                        shapes, migration from the old keys
 */
export type {
  RuleOperationResult,
  RuleTrigger,
  RuleZone,
  ZoneLightRule,
  ZoneLightRuleKind,
  ZoneLightRulePreset,
  ZoneLightRuleStore,
  ZoneLightRuleValue,
} from "./zone-light-rules/types";
export {
  adaptiveRuleEnabled,
  builtinRuleId,
  builtinRules,
  createRule,
  defaultZoneRules,
  deleteRule,
  effectiveZoneRules,
  findRule,
  isBuiltinRuleId,
  newRuleId,
  presetRowRules,
  reorderRules,
  ruleTrigger,
  storeFromLighting,
  updateRule,
  WHITE_RULE_VALUE,
} from "./zone-light-rules/rules-model";
export { migrateLightingRules, projectLightingRules } from "./zone-light-rules/migration-model";
