import WebSocket from "ws";
import {
  AreaRegistryEntry,
  DashboardEntity,
  DashboardState,
  DashboardZone,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HaDomain,
  HaState,
  RouterMetric,
  RouterStatus,
  SunStatus,
  WeatherStatus,
} from "./types";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";

const HA_URL = process.env.HA_URL ?? "http://127.0.0.1:8123";
const HA_TOKEN = process.env.HA_TOKEN;

const CONTROL_DOMAINS: HaDomain[] = [
  "light",
  "switch",
  "climate",
  "fan",
  "cover",
  "humidifier",
  "sensor",
];

const ILLUMINATION_RE = /\b(neon|light|lights|lamp|lamps|led|strip|glow|fairy|sign|illumination)\b/i;
const SUPPORT_SWITCH_RE = /\bauto[-_ ]?update\b/i;
const EVERYTHING_EXCLUDED_ENTITIES = new Set(["light.outside_light"]);
const CLIMATE_AREA_NAMES = new Set(["climate", "heating"]);
const NETWORK_ZONE_ID = "network";
const WEATHER_ENTITY_ID = "weather.forecast_home";
const ROUTER_STATUS_CACHE_MS = 250;
const WEATHER_FORECAST_CACHE_MS = 35 * 60 * 1000;
const LOUNGE_SENSOR_ENTITY_IDS = new Set([
  "sensor.wifi_temperature_humidity_sensor_temperature",
  "sensor.wifi_temperature_humidity_sensor_humidity",
  "sensor.lounge_temperature",
  "sensor.lounge_humidity",
]);
let routerStatusCache: { at: number; value: RouterStatus } | null = null;
let routerStatusRequest: Promise<RouterStatus> | null = null;
let weatherForecastCache: { at: number; entityId: string; value: WeatherForecastEntry | null } | null = null;
let weatherForecastRequest: Promise<WeatherForecastEntry | null> | null = null;

type WeatherForecastEntry = Record<string, unknown>;

function authHeaders() {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function haRest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${HA_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

export async function callService(
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
) {
  const startedAt = Date.now();
  const shouldLog = domain === "climate";

  if (shouldLog) {
    console.info("[nova-dashboard] HA climate service call", { domain, service, serviceData });
  }

  try {
    const result = await haRest<HaState[]>(`/api/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(serviceData),
    });

    if (shouldLog) {
      console.info("[nova-dashboard] HA climate service success", {
        domain,
        durationMs: Date.now() - startedAt,
        result: result.map((state) => ({
          attributes: state.attributes,
          entity_id: state.entity_id,
          state: state.state,
        })),
        service,
        serviceData,
      });
    }

    return result;
  } catch (error) {
    if (shouldLog) {
      console.error("[nova-dashboard] HA climate service failed", {
        domain,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        service,
        serviceData,
      });
    }

    throw error;
  }
}

async function callServiceWithResponse<T>(
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
) {
  return haRest<T>(`/api/services/${domain}/${service}?return_response`, {
    method: "POST",
    body: JSON.stringify(serviceData),
  });
}

async function haWs<T>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  const wsUrl = `${HA_URL.replace(/^http/i, "ws")}/api/websocket`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 10000);

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
        return;
      }

      if (message.type === "auth_invalid") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("Home Assistant WebSocket auth failed"));
        return;
      }

      if (message.type === "auth_ok") {
        ws.send(JSON.stringify({ id, type, ...payload }));
        return;
      }

      if (message.id === id) {
        clearTimeout(timer);
        ws.close();
        if (message.success) {
          resolve(message.result as T);
        } else {
          reject(new Error(message.error?.message ?? `Home Assistant ${type} failed`));
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function registryData() {
  const [areas, devices, entities] = await Promise.allSettled([
    haWs<AreaRegistryEntry[]>("config/area_registry/list"),
    haWs<DeviceRegistryEntry[]>("config/device_registry/list"),
    haWs<EntityRegistryEntry[]>("config/entity_registry/list"),
  ]);

  return {
    areas:
      areas.status === "fulfilled"
        ? areas.value.map((area) => ({
            ...area,
            id: area.id ?? area.area_id ?? area.name.toLowerCase().replaceAll(" ", "_"),
          }))
        : [],
    devices: devices.status === "fulfilled" ? devices.value : [],
    entities: entities.status === "fulfilled" ? entities.value : [],
    warnings: [areas, devices, entities]
      .filter((result) => result.status === "rejected")
      .map((result) => (result as PromiseRejectedResult).reason?.message ?? "Registry read failed"),
  };
}

function domainOf(entityId: string): HaDomain | null {
  const domain = entityId.split(".")[0] as HaDomain;
  return CONTROL_DOMAINS.includes(domain) ? domain : null;
}

function friendlyName(state: HaState, registry?: EntityRegistryEntry) {
  return (
    registry?.name ??
    registry?.original_name ??
    (state.attributes.friendly_name as string | undefined) ??
    state.entity_id
  );
}

function isIlluminationSwitch(entity: Pick<DashboardEntity, "domain" | "entity_id" | "name">) {
  if (entity.domain !== "switch") {
    return false;
  }

  return ILLUMINATION_RE.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

function isSupportSwitch(entity: Pick<DashboardEntity, "domain" | "entity_id" | "name">) {
  if (entity.domain !== "switch") {
    return false;
  }

  return SUPPORT_SWITCH_RE.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

function isDashboardSensor(state: HaState, name: string) {
  if (LOUNGE_SENSOR_ENTITY_IDS.has(state.entity_id)) {
    return true;
  }

  const deviceClass = String(state.attributes.device_class ?? "").toLowerCase();
  if (deviceClass !== "temperature" && deviceClass !== "humidity") {
    return false;
  }

  const text = `${state.entity_id} ${name}`.toLowerCase();
  return text.includes("lounge");
}

function lightLayerEntities(entities: DashboardEntity[]) {
  return entities.filter((entity) => entity.domain === "light" || entity.isIllumination);
}

function getBrightnessPct(entities: DashboardEntity[]) {
  const values = entities
    .filter((entity) => entity.domain === "light" && entity.state === "on")
    .map((entity) => Number(entity.attributes.brightness ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) {
    return 0;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average / 255) * 100);
}

function countDomains(entities: DashboardEntity[]) {
  return CONTROL_DOMAINS.reduce(
    (counts, domain) => {
      if (domain === "light") {
        counts[domain] = lightLayerEntities(entities).length;
      } else if (domain === "switch") {
        counts[domain] = entities.filter((entity) => entity.domain === "switch" && !entity.isIllumination).length;
      } else {
        counts[domain] = entities.filter((entity) => entity.domain === domain).length;
      }
      return counts;
    },
    {} as Record<HaDomain, number>,
  );
}

function isEntityOn(entity: DashboardEntity) {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }

  if (entity.domain === "climate") {
    return entity.state !== "off";
  }

  if (entity.domain === "sensor") {
    return false;
  }

  return ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"].includes(entity.state);
}

function zoneFromEntities(id: string, name: string, entities: DashboardEntity[]): DashboardZone {
  return {
    id,
    name,
    entities,
    counts: countDomains(entities),
    isOn: entities.some(isEntityOn),
    brightnessPct: getBrightnessPct(entities),
  };
}

function stateById(states: HaState[], entityId: string) {
  return states.find((state) => state.entity_id === entityId);
}

function speedMetric(states: HaState[], entityId: string): RouterMetric {
  const state = stateById(states, entityId);
  const unit = String(state?.attributes?.unit_of_measurement ?? "MB/s");
  const value = Number(state?.state);
  const numericValue = Number.isFinite(value) ? value : null;

  return {
    entity_id: entityId,
    value: numericValue,
    unit,
    display: numericValue === null ? "--" : `${formatSpeed(numericValue)} ${unit}`,
  };
}

function formatSpeed(value: number) {
  if (value >= 10) {
    return value.toFixed(0);
  }
  if (value >= 0.1) {
    return value.toFixed(1);
  }
  if (value > 0) {
    return value.toFixed(3);
  }
  return "0.0";
}

function buildRouterStatus(states: HaState[]): RouterStatus {
  const wan = stateById(states, "binary_sensor.nx620v_wan_status");
  const externalIp = stateById(states, "sensor.nx620v_external_ip")?.state;

  return {
    name: "NX620v",
    download: speedMetric(states, "sensor.nx620v_download_speed"),
    upload: speedMetric(states, "sensor.nx620v_upload_speed"),
    externalIp: externalIp && !["unknown", "unavailable"].includes(externalIp) ? externalIp : "--",
    wanConnected: wan ? wan.state === "on" : null,
    wanState: wan ? (wan.state === "on" ? "Connected" : "Disconnected") : "Unknown",
  };
}

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

export async function warmWeatherCache(entityId = WEATHER_ENTITY_ID): Promise<void> {
  weatherForecastCache = null;
  await dailyWeatherForecast(entityId).catch((error) => {
    console.warn("[nova-dashboard] Background weather refresh failed", { error });
  });
}

async function buildWeatherStatus(states: HaState[], warnings: string[]): Promise<WeatherStatus | null> {
  const weatherState = stateById(states, WEATHER_ENTITY_ID) ?? states.find((state) => state.entity_id.startsWith("weather."));
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

function buildSunStatus(states: HaState[]): SunStatus | null {
  const sun = stateById(states, "sun.sun");
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

export async function buildRouterStatusOnly(): Promise<RouterStatus> {
  const now = Date.now();
  if (routerStatusCache && now - routerStatusCache.at < ROUTER_STATUS_CACHE_MS) {
    return routerStatusCache.value;
  }

  if (!routerStatusRequest) {
    routerStatusRequest = haRest<HaState[]>("/api/states")
      .then((states) => {
        const value = buildRouterStatus(states);
        routerStatusCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        routerStatusRequest = null;
      });
  }

  return routerStatusRequest;
}

export async function buildDashboardState(): Promise<DashboardState> {
  const [states, registries] = await Promise.all([haRest<HaState[]>("/api/states"), registryData()]);
  const entityById = new Map(registries.entities.map((entity) => [entity.entity_id, entity]));
  const deviceById = new Map(registries.devices.map((device) => [device.id, device]));
  const areaById = new Map(registries.areas.map((area) => [area.id as string, area]));
  const climateAreaIds = new Set(
    registries.areas
      .filter((area) => CLIMATE_AREA_NAMES.has(String(area.name).trim().toLowerCase()))
      .map((area) => area.id as string),
  );
  const networkAreaIds = new Set(
    registries.areas
      .filter((area) => String(area.name).trim().toLowerCase() === NETWORK_ZONE_ID || area.id === NETWORK_ZONE_ID)
      .map((area) => area.id as string),
  );
  const warnings = [...registries.warnings];

  const entities: DashboardEntity[] = states.flatMap((state) => {
    const domain = domainOf(state.entity_id);
    if (!domain) {
      return [];
    }

    const registry = entityById.get(state.entity_id);
    if (registry?.disabled_by || registry?.hidden_by) {
      return [];
    }

    const device = registry?.device_id ? deviceById.get(registry.device_id) : undefined;
    const areaId = registry?.area_id ?? device?.area_id ?? "unassigned";
    const name = friendlyName(state, registry);
    if (domain === "sensor" && !isDashboardSensor(state, name)) {
      return [];
    }

    const entity = {
      entity_id: state.entity_id,
      domain,
      state: state.state,
      name,
      area_id: areaId,
      device_id: registry?.device_id,
      attributes: state.attributes ?? {},
    };

    const dashboardEntity = {
      ...entity,
      isIllumination: isIlluminationSwitch(entity),
    };

    if (isSupportSwitch(dashboardEntity)) {
      return [];
    }

    return [dashboardEntity];
  });

  const zones = registries.areas
    .map((area) =>
      zoneFromEntities(
        area.id as string,
        area.name,
        entities.filter((entity) => entity.area_id === area.id),
      ),
    )
    .filter((zone) => zone.entities.length > 0);

  const unassigned = entities.filter((entity) => entity.area_id === "unassigned");
  if (unassigned.length) {
    zones.push(zoneFromEntities("unassigned", "Unassigned", unassigned));
  }

  const areaIdsWithEntities = new Set(entities.map((entity) => entity.area_id));
  for (const areaId of areaIdsWithEntities) {
    if (areaId !== "unassigned" && !areaById.has(areaId)) {
      zones.push(
        zoneFromEntities(
          areaId,
          areaId.replaceAll("_", " "),
          entities.filter((entity) => entity.area_id === areaId),
        ),
      );
    }
  }

  zones.sort((a, b) => a.name.localeCompare(b.name));
  if (!zones.some((zone) => zone.id === NETWORK_ZONE_ID || zone.name.trim().toLowerCase() === NETWORK_ZONE_ID)) {
    zones.push(zoneFromEntities(NETWORK_ZONE_ID, "Network", []));
  }

  zones.unshift(
    zoneFromEntities(
      "everything",
      "Home",
      entities.filter(
        (entity) =>
          !EVERYTHING_EXCLUDED_ENTITIES.has(entity.entity_id) &&
          entity.domain !== "climate" &&
          !climateAreaIds.has(entity.area_id) &&
          !networkAreaIds.has(entity.area_id),
      ),
    ),
  );

  if (!entities.some((entity) => ["light", "switch", "climate"].includes(entity.domain))) {
    warnings.push("Home Assistant currently has no light, switch, or climate entities.");
  }

  return {
    generatedAt: new Date().toISOString(),
    zones,
    entities,
    totals: countDomains(entities),
    router: buildRouterStatus(states),
    sun: buildSunStatus(states),
    weather: await buildWeatherStatus(states, warnings),
    preferences: await readDashboardPreferences(),
    warnings,
  };
}

function supportedModes(entity: DashboardEntity) {
  const modes = entity.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.map(String) : [];
}

function supportsBrightness(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

function supportsColor(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

function numericAttribute(entity: DashboardEntity, name: string) {
  const value = Number(entity.attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function miredToKelvin(value: number) {
  return Math.round(1_000_000 / value);
}

function colorTempKelvinRange(entity: DashboardEntity) {
  const maxMireds = numericAttribute(entity, "max_mireds");
  const minMireds = numericAttribute(entity, "min_mireds");
  const minKelvin = numericAttribute(entity, "min_color_temp_kelvin") ?? (maxMireds ? miredToKelvin(maxMireds) : null);
  const maxKelvin = numericAttribute(entity, "max_color_temp_kelvin") ?? (minMireds ? miredToKelvin(minMireds) : null);

  return { minKelvin, maxKelvin };
}

function supportsColorTemp(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  const range = colorTempKelvinRange(entity);
  return modes.includes("color_temp") || range.minKelvin !== null || range.maxKelvin !== null;
}

function presetColorTempKelvin(entity: DashboardEntity, preset: "candlelight" | "white") {
  const range = colorTempKelvinRange(entity);
  if (preset === "candlelight") {
    return range.minKelvin ?? 1800;
  }
  return range.maxKelvin ?? 6500;
}

async function callMany(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  if (failures.length && failures.length === results.length) {
    throw failures[0].reason;
  }
}

export async function setZoneAction(input: {
  zoneId: string;
  action: "on" | "off" | "brightness" | "color" | "candlelight" | "white";
  brightnessPct?: number;
  rgb?: [number, number, number];
  traceId?: string;
}) {
  const dashboard = await buildDashboardState();
  const zone = dashboard.zones.find((candidate) => candidate.id === input.zoneId);

  if (!zone) {
    throw new Error(`Unknown zone: ${input.zoneId}`);
  }

  const lights = zone.entities.filter((entity) => entity.domain === "light");
  const switches = zone.entities.filter((entity) => entity.domain === "switch" && !isSupportSwitch(entity));
  const illuminationSwitches = switches.filter((entity) => entity.isIllumination);
  const climates = zone.entities.filter((entity) => entity.domain === "climate");

  if (climates.length) {
    console.info("[nova-dashboard] climate zone action", {
      action: input.action,
      climates: climates.map((entity) => ({
        attributes: entity.attributes,
        entity_id: entity.entity_id,
        name: entity.name,
        state: entity.state,
      })),
      traceId: input.traceId,
      zoneId: input.zoneId,
    });
  }

  if (input.action === "off") {
    await callMany([
      ...lights.map((entity) => callService("light", "turn_off", { entity_id: entity.entity_id })),
      ...switches.map((entity) => callService("switch", "turn_off", { entity_id: entity.entity_id })),
      ...climates.map((entity) => callService("climate", "turn_off", { entity_id: entity.entity_id })),
    ]);
    return buildDashboardState();
  }

  if (input.action === "brightness") {
    const brightness = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? 0)));
    if (brightness === 0) {
      await callMany([
        ...lights.map((entity) => callService("light", "turn_off", { entity_id: entity.entity_id })),
        ...illuminationSwitches.map((entity) => callService("switch", "turn_off", { entity_id: entity.entity_id })),
      ]);
      return buildDashboardState();
    }

    await callMany([
      ...illuminationSwitches.map((entity) => callService("switch", "turn_on", { entity_id: entity.entity_id })),
      ...lights.map((entity) => {
        const payload: Record<string, unknown> = { entity_id: entity.entity_id };
        if (supportsBrightness(entity)) {
          payload.brightness_pct = brightness;
        }
        return callService("light", "turn_on", payload);
      }),
    ]);
    return buildDashboardState();
  }

  if (input.action === "color") {
    const brightnessBase = input.brightnessPct ?? zone.brightnessPct;
    const brightness = Math.max(1, Math.min(100, Math.round(brightnessBase || 100)));
    const rgb = input.rgb ?? [255, 180, 90];
    await callMany([
      ...illuminationSwitches.map((entity) => callService("switch", "turn_on", { entity_id: entity.entity_id })),
      ...lights.map((entity) => {
        const payload: Record<string, unknown> = { entity_id: entity.entity_id };
        if (supportsColor(entity)) {
          payload.rgb_color = rgb;
        }
        if (supportsBrightness(entity)) {
          payload.brightness_pct = brightness;
        }
        return callService("light", "turn_on", payload);
      }),
    ]);
    return buildDashboardState();
  }

  const preset = input.action === "white" ? "white" : "candlelight";
  const brightnessBase = input.brightnessPct ?? zone.brightnessPct;
  const brightness = Math.max(1, Math.min(100, Math.round(brightnessBase || 86)));

  await callMany([
    ...illuminationSwitches.map((entity) => callService("switch", "turn_on", { entity_id: entity.entity_id })),
    ...switches
      .filter((entity) => !entity.isIllumination)
      .map((entity) =>
        input.action === "on" ? callService("switch", "turn_on", { entity_id: entity.entity_id }) : Promise.resolve(),
      ),
    ...lights.map((entity) => {
      const payload: Record<string, unknown> = { entity_id: entity.entity_id };
      if (supportsBrightness(entity)) {
        payload.brightness_pct = brightness;
      }
      if (preset === "candlelight") {
        if (supportsColorTemp(entity)) {
          payload.color_temp_kelvin = presetColorTempKelvin(entity, "candlelight");
        } else if (supportsColor(entity)) {
          payload.rgb_color = [255, 147, 41];
        }
      } else if (supportsColorTemp(entity)) {
        payload.color_temp_kelvin = presetColorTempKelvin(entity, "white");
      } else if (supportsColor(entity)) {
        payload.rgb_color = [255, 255, 255];
      }
      return callService("light", "turn_on", payload);
    }),
  ]);

  return buildDashboardState();
}

export async function setEntityAction(input: {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: Parameters<typeof mergeDashboardPreferences>[0];
  traceId?: string;
}) {
  const allowed: Record<HaDomain, string[]> = {
    light: ["turn_on", "turn_off", "toggle"],
    switch: ["turn_on", "turn_off", "toggle"],
    climate: [
      "turn_on",
      "turn_off",
      "set_hvac_mode",
      "set_temperature",
      "set_fan_mode",
      "set_swing_mode",
    ],
    fan: ["turn_on", "turn_off", "toggle", "set_percentage"],
    cover: ["open_cover", "close_cover", "stop_cover"],
    humidifier: ["turn_on", "turn_off", "toggle", "set_humidity"],
    sensor: [],
  };

  if (!allowed[input.domain]?.includes(input.service)) {
    throw new Error(`Service ${input.domain}.${input.service} is not allowed`);
  }

  const isAirconRelated =
    input.domain === "climate" ||
    `${input.entityId} ${input.service}`.toLowerCase().match(/\b(air|gree|quiet|turbo|xtra)\b/) !== null;

  if (isAirconRelated) {
    console.info("[nova-dashboard] aircon setEntityAction start", {
      data: input.data ?? {},
      domain: input.domain,
      entityId: input.entityId,
      remember: input.remember,
      service: input.service,
      traceId: input.traceId,
    });
  }

  try {
    await callService(input.domain, input.service, {
      entity_id: input.entityId,
      ...(input.data ?? {}),
    });
  } catch (error) {
    if (isAirconRelated) {
      console.error("[nova-dashboard] aircon setEntityAction service failed", {
        data: input.data ?? {},
        domain: input.domain,
        entityId: input.entityId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        service: input.service,
        traceId: input.traceId,
      });
    }

    throw error;
  }

  if (input.remember) {
    if (isAirconRelated) {
      console.info("[nova-dashboard] aircon preference merge", {
        remember: input.remember,
        traceId: input.traceId,
      });
    }
    await mergeDashboardPreferences(input.remember);
  }

  const nextState = await buildDashboardState();

  if (isAirconRelated) {
    const entity = nextState.entities.find((candidate) => candidate.entity_id === input.entityId);
    console.info("[nova-dashboard] aircon setEntityAction complete", {
      entity: entity
        ? {
            attributes: entity.attributes,
            entity_id: entity.entity_id,
            name: entity.name,
            state: entity.state,
          }
        : null,
      traceId: input.traceId,
    });
  }

  return nextState;
}
