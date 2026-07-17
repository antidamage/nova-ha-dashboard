import type { DashboardConfig } from "../../config-schema";
import type { HaState, SunStatus, WeatherStatus } from "../../types";
import { callServiceWithResponse } from "../../ha/client";
import { readDashboardConfig } from "../../dashboard-config";
import { stateById } from "../../ha/states";
import type { DashboardModule, ModuleStateContext, ModuleStatus } from "../types";

const WEATHER_FORECAST_CACHE_MS = 35 * 60 * 1000;

type WeatherForecastEntry = Record<string, unknown>;

let weatherForecastCache: { at: number; entityId: string; value: WeatherForecastEntry | null } | null = null;
let weatherForecastRequest: Promise<WeatherForecastEntry | null> | null = null;

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOne(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function estimateRainChance(condition: string, precipitation: number | null) {
  const normalized = condition.toLowerCase();
  if (normalized.includes("rain") || normalized.includes("pouring") || normalized.includes("lightning")) {
    return Math.round(Math.max(65, Math.min(95, 78 + (precipitation ?? 0) * 4)));
  }
  if (precipitation !== null && precipitation > 0) {
    return Math.round(Math.max(25, Math.min(85, 30 + precipitation * 16)));
  }
  if (normalized.includes("cloud")) {
    return 20;
  }
  if (normalized.includes("sun") || normalized.includes("clear")) {
    return 5;
  }
  return null;
}

function apparentTemperature(temperature: number | null, humidity: number | null, windSpeed: number | null, windUnit: string) {
  if (temperature === null || humidity === null || windSpeed === null) {
    return null;
  }

  const windKmh = windUnit.toLowerCase().includes("mph") ? windSpeed * 1.60934 : windSpeed;
  const windMs = windKmh / 3.6;
  const vapourPressure = (humidity / 100) * 6.105 * Math.exp((17.27 * temperature) / (237.7 + temperature));

  return roundOne(temperature + 0.33 * vapourPressure - 0.7 * windMs - 4);
}

async function dailyWeatherForecast(entityId: string) {
  const now = Date.now();
  if (weatherForecastCache?.entityId === entityId && now - weatherForecastCache.at < WEATHER_FORECAST_CACHE_MS) {
    return weatherForecastCache.value;
  }

  if (!weatherForecastRequest) {
    weatherForecastRequest = callServiceWithResponse<{
      service_response?: Record<string, { forecast?: WeatherForecastEntry[] }>;
    }>("weather", "get_forecasts", { entity_id: entityId, type: "daily" })
      .then((response) => response.service_response?.[entityId]?.forecast?.[0] ?? null)
      .then((value) => {
        weatherForecastCache = { at: Date.now(), entityId, value };
        return value;
      })
      .finally(() => {
        weatherForecastRequest = null;
      });
  }

  return weatherForecastRequest;
}

export async function warmWeatherCache(entityId?: string): Promise<void> {
  const weatherEntityId = entityId ?? (await readDashboardConfig()).homeAssistant.weatherEntityId;
  weatherForecastCache = null;
  await dailyWeatherForecast(weatherEntityId).catch((error) => {
    console.warn("[nova-dashboard] Background weather refresh failed", { error });
  });
}

export async function buildWeatherStatus(
  states: HaState[],
  warnings: string[],
  config: DashboardConfig,
): Promise<WeatherStatus | null> {
  const weatherEntityId = config.homeAssistant.weatherEntityId;
  const weatherState = stateById(states, weatherEntityId) ?? states.find((state) => state.entity_id.startsWith("weather."));
  if (!weatherState) {
    return null;
  }

  let forecast: WeatherForecastEntry | null = null;
  try {
    forecast = await dailyWeatherForecast(weatherState.entity_id);
  } catch (error) {
    warnings.push(error instanceof Error ? `Weather forecast unavailable: ${error.message}` : "Weather forecast unavailable.");
  }

  const attrs = weatherState.attributes ?? {};
  const windUnit = String(attrs.wind_speed_unit ?? "km/h");
  const precipitation = numberOrNull(forecast?.precipitation);
  const condition = String(forecast?.condition ?? weatherState.state ?? "unknown");
  const temperature = numberOrNull(attrs.temperature);
  const humidity = numberOrNull(attrs.humidity ?? forecast?.humidity);
  const windSpeed = numberOrNull(attrs.wind_speed ?? forecast?.wind_speed);
  const uvIndex = numberOrNull(attrs.uv_index);
  const maxUvIndex = numberOrNull(forecast?.uv_index) ?? uvIndex;

  return {
    entity_id: weatherState.entity_id,
    condition,
    temperature: roundOne(temperature),
    high: roundOne(numberOrNull(forecast?.temperature) ?? temperature),
    low: roundOne(numberOrNull(forecast?.templow)),
    humidity: roundOne(humidity),
    windSpeed: roundOne(windSpeed),
    windUnit,
    precipitation: roundOne(precipitation),
    precipitationUnit: String(attrs.precipitation_unit ?? "mm"),
    rainChancePct: estimateRainChance(condition, precipitation),
    uvIndex: roundOne(uvIndex),
    maxUvIndex: roundOne(maxUvIndex),
    feelsLike: apparentTemperature(temperature, humidity, windSpeed, windUnit),
  };
}

export function buildSunStatus(states: HaState[], config: DashboardConfig): SunStatus | null {
  const sun = stateById(states, config.homeAssistant.sunEntityId);
  if (!sun) {
    return null;
  }

  return {
    entity_id: sun.entity_id,
    state: sun.state,
    nextRising: typeof sun.attributes.next_rising === "string" ? sun.attributes.next_rising : null,
    nextSetting: typeof sun.attributes.next_setting === "string" ? sun.attributes.next_setting : null,
  };
}

export const weatherModule: DashboardModule = {
  id: "weather",
  title: "Weather & Sun",
  description: "Current conditions, daily forecast, and sun position from Home Assistant.",
  status(context: ModuleStateContext): ModuleStatus {
    const ha = context.config.homeAssistant;
    const has = (id: string) => context.states.some((state) => state.entity_id === id);
    const hasAnyWeather = context.states.some((state) => state.entity_id.startsWith("weather."));
    const requirements = [
      {
        ok: has(ha.weatherEntityId) || hasAnyWeather,
        label: "Weather entity",
        detail: ha.weatherEntityId,
      },
      { ok: has(ha.sunEntityId), label: "Sun entity", detail: ha.sunEntityId },
    ];
    return {
      id: this.id,
      title: this.title,
      active: requirements[0].ok,
      requirements,
    };
  },
};
