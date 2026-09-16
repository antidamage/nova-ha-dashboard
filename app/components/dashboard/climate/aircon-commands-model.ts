import type { AirconPreferences, DashboardEntity } from "../../../../lib/types";
import {
  airconEntityMode,
  climateTargetTemperature,
  isAirconMode,
  type EntityActionInput,
} from "../../../../lib/aircon-control";

export function timerEndMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function autoPreferenceFallbackAction(entity: DashboardEntity, settings: AirconPreferences): EntityActionInput {
  const temperature = typeof settings.temperature === "number" ? settings.temperature : climateTargetTemperature(entity);
  const mode = isAirconMode(settings.hvacMode) && settings.hvacMode !== "auto"
    ? settings.hvacMode
    : airconEntityMode(entity);

  return {
    entityId: entity.entity_id,
    domain: "climate",
    service: "set_temperature",
    data: typeof temperature === "number" ? { temperature } : undefined,
    remember: {
      aircon: {
        autoMode: true,
        hvacMode: mode,
        temperature: typeof temperature === "number" ? temperature : undefined,
      },
    },
  };
}
