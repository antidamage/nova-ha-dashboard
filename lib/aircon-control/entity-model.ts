import type { DashboardEntity } from "../types";
import { autonomousClimateInputIsUsable } from "../autonomous-climate-safety";

export function stringListAttribute(entity: DashboardEntity, name: string) {
  const value = entity.attributes[name];
  return Array.isArray(value) ? value.map(String) : [];
}

export function numericClimateAttribute(entity: Pick<DashboardEntity, "attributes">, name: string) {
  const raw = entity.attributes[name];
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function climateTargetTemperature(entity: DashboardEntity) {
  return numericClimateAttribute(entity, "temperature") ?? numericClimateAttribute(entity, "current_temperature");
}

export function climateCurrentTemperature(entity: Pick<DashboardEntity, "attributes">) {
  return numericClimateAttribute(entity, "current_temperature");
}

export function isClimateEntityOn(entity: DashboardEntity) {
  return !["off", "unavailable", "unknown"].includes(entity.state);
}

// The aircon's own sensor is the measurement the auto loop acts on. It used to
// prefer the third-party lounge sensor; that sensor is being relocated, so the
// unit is the source now.
type AirconTemperatureSource = Pick<
  DashboardEntity,
  "attributes" | "entity_id" | "state" | "last_changed" | "last_updated" | "last_reported"
>;

export function airconAutoMeasuredTemperature(entity?: AirconTemperatureSource, now: number = Date.now()) {
  const measurement = entity ? climateCurrentTemperature(entity) : null;
  return autonomousClimateInputIsUsable(
    entity
      ? {
          measurement,
          sourceState: entity.state,
          last_changed: entity.last_changed,
          last_updated: entity.last_updated,
          last_reported: entity.last_reported,
        }
      : undefined,
    now,
  )
    ? measurement
    : null;
}

function airconIdentityText(entity: Pick<DashboardEntity, "attributes" | "entity_id">) {
  return `${entity.entity_id} ${String(entity.attributes.friendly_name ?? "")}`.toLowerCase();
}

/**
 * Locate Nova's autonomous air conditioner without ever falling back to a
 * heater. Both the browser controller and the server watchdog use this exact
 * selector so the safety monitor cannot watch a different device from Auto.
 */
/**
 * Words that identify an air conditioner in any home. Deliberately generic: the
 * list used to include one manufacturer and one household's entity id, which
 * meant another installation's unit could only be found by the weaker
 * "not a heater" fallback below. Installations whose unit is named unusually add
 * their own via `dashboard.aircon.matchTokens`.
 */
const AIRCON_MATCH_TOKENS = ["air conditioner", "air con", "aircon", "heat pump"];

export function dashboardAirconEntity<T extends Pick<DashboardEntity, "attributes" | "entity_id">>(
  entities: readonly T[],
  configuredMatchTokens: readonly string[] = [],
) {
  const tokens = [...configuredMatchTokens, ...AIRCON_MATCH_TOKENS]
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const climates = entities.filter((entity) => entity.entity_id.startsWith("climate."));
  const explicit = climates.find((entity) =>
    tokens.some((token) => airconIdentityText(entity).includes(token)),
  );
  if (explicit) {
    return explicit;
  }
  return climates.find((entity) => !["heater", "panel"].some((token) => airconIdentityText(entity).includes(token)));
}
