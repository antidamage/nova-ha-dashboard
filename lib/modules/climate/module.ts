import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../types";

// The aircon's current_temperature is served through untouched: the unit's own
// sensor is the reading the card shows and the auto thermostat acts on.
//
// This used to be overridden with the third-party room sensor, because the Gree's
// internal return-air thermistor heat-soaks while the unit is idle. That override
// was removed deliberately (2026-08-08) — the room sensor is being relocated, so
// the unit is now the aircon's temperature source. If a trusted room sensor is
// bound to the aircon again later, reinstate it as a config-driven binding rather
// than a hardcoded entity id.

export const climateModule: DashboardModule = {
  id: "climate",
  title: "Climate",
  description: "Aircon and heater control.",
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
