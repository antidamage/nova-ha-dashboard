import type { ControlModuleField, ControlModuleFieldId } from "./types";

/**
 * The binding fields a preset can carry (specs/control-modules.md).
 *
 * A module lists which of these are meaningful to it, and the editor renders
 * exactly that list — the same discipline the installable module system uses for
 * its config form. Every one is a value only this installation knows, so it lives
 * in config and never in module source.
 */

export const FIELD_ENTITY: ControlModuleField = {
  id: "entityId",
  label: "Climate entity",
  detail: "Bind the unit explicitly when the room has more than one",
  kind: "entity",
  candidates: "climate",
};

export const FIELD_MATCH_TOKENS: ControlModuleField = {
  id: "matchTokens",
  label: "Match words",
  detail: "Words in the unit's name or id, for hardware named after its maker",
  kind: "token-list",
};

export const FIELD_SWITCH_IDS: ControlModuleField = {
  id: "switchEntityIds",
  label: "Switch entities",
  detail: "Most preferred first, so a local twin can lead its cloud counterpart",
  kind: "entity-list",
  candidates: "switch",
  required: true,
};

export const FIELD_TEMPERATURE_IDS: ControlModuleField = {
  id: "temperatureEntityIds",
  label: "Room temperature sensors",
  detail: "Most trusted first — the order is a safety property, not a preference",
  kind: "entity-list",
  candidates: "sensor",
};

export const FIELD_HUMIDITY_IDS: ControlModuleField = {
  id: "humidityEntityIds",
  label: "Room humidity sensors",
  detail: "Most trusted first",
  kind: "entity-list",
  candidates: "sensor",
};

export const FIELD_DRY_HUMIDITY: ControlModuleField = {
  id: "dryTargetHumidityPct",
  label: "Dry target humidity",
  detail: "What Dry emulation aims the room at",
  kind: "number",
};

const BY_ID: Record<ControlModuleFieldId, ControlModuleField> = {
  dryTargetHumidityPct: FIELD_DRY_HUMIDITY,
  entityId: FIELD_ENTITY,
  humidityEntityIds: FIELD_HUMIDITY_IDS,
  matchTokens: FIELD_MATCH_TOKENS,
  switchEntityIds: FIELD_SWITCH_IDS,
  temperatureEntityIds: FIELD_TEMPERATURE_IDS,
};

/**
 * A field NAMED by an installed package, resolved to the shipped definition.
 * A package lists ids rather than definitions for exactly this reason: the
 * labels, the picker candidates and the editor treatment are the product's, so
 * an uploaded device type cannot arrive with a differently-behaving field.
 */
export function controlModuleField(id: ControlModuleFieldId): ControlModuleField {
  return BY_ID[id];
}
