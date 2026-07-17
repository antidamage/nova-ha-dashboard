import type { DashboardEntity } from "../../types";
import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../types";

// The Gree lounge aircon reports its own internal return-air temperature, which
// heat-soaks to ~24C while the unit is idle and is always wrong. The lounge's
// trusted reading is the third-party Tuya sensor. We override the aircon's
// current_temperature here so the nova backend is the single source of truth and
// every client (Apple TV + web) shows the real room temperature. The panel heater
// lives in another room with a working sensor and is deliberately left untouched.
const LOUNGE_AIRCON_ENTITY_IDS = new Set(["climate.c6780cad"]);
const LOUNGE_AIRCON_NAME_RE = /\bair\s?con(ditioner)?\b/i;

function isLoungeAircon(entity: DashboardEntity) {
  if (entity.domain !== "climate") {
    return false;
  }
  if (LOUNGE_AIRCON_ENTITY_IDS.has(entity.entity_id)) {
    return true;
  }
  return LOUNGE_AIRCON_NAME_RE.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

function loungeTemperatureFromEntities(entities: DashboardEntity[], sensorIds: string[]) {
  for (const sensorId of sensorIds) {
    const sensor = entities.find((entity) => entity.entity_id === sensorId);
    const value = Number(sensor?.state);
    if (sensor && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

// Replace the lounge aircon's (always-wrong) internal current_temperature with the
// trusted Tuya room sensor so the backend serves the real value to every client.
export function applyLoungeAirconTemperatureOverride(entities: DashboardEntity[], sensorIds: string[]) {
  const temperature = loungeTemperatureFromEntities(entities, sensorIds);
  if (temperature === null) {
    return;
  }
  for (const entity of entities) {
    if (isLoungeAircon(entity)) {
      entity.attributes = { ...entity.attributes, current_temperature: temperature };
    }
  }
}

export const climateModule: DashboardModule = {
  id: "climate",
  title: "Climate",
  description: "Aircon and heater control, with trusted room-sensor temperature overrides.",
  transformEntities(context: ModuleStateContext) {
    applyLoungeAirconTemperatureOverride(
      context.entities,
      context.config.homeAssistant.loungeSensorEntityIds.filter((id) => id.includes("temperature")),
    );
  },
  status(context: ModuleStateContext): ModuleStatus {
    const climateEntities = context.entities.filter((entity) => entity.domain === "climate");
    return {
      id: this.id,
      title: this.title,
      active: climateEntities.length > 0,
      summary: `${climateEntities.length} climate entit${climateEntities.length === 1 ? "y" : "ies"}`,
      requirements: [
        {
          ok: climateEntities.length > 0,
          label: "At least one climate entity",
          detail: climateEntities.map((entity) => entity.entity_id).join(", ") || undefined,
        },
      ],
    };
  },
};
