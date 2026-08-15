import { DEFAULT_ORB_DISPLAY } from "./format";
import {
  ORB_MODULE_OUTPUT_EMPTY,
  type OrbInfoDisplay,
  type OrbModuleDefinition,
  type OrbModuleOutput,
  type OrbModuleParams,
} from "./types";

/**
 * The status orb info module catalogue.
 *
 * Every module here reads from a source the dashboard ALREADY has on the
 * client, so adding one costs no new backend service. `sources` declares what
 * the module needs; the orb subscribes to exactly that set and nothing else, so
 * selecting `none` or `clock` starts no polling at all.
 */

/** The narrow slices of shared client data the catalogue reads. */
export type OrbInfoSources = {
  now: number;
  watchface: {
    gymLastResetAt: number | null;
    gymAlertThresholdHours: number | null;
  } | null;
  novaLoad: {
    cpu: number;
    gpu: number;
    net: number;
    load: number;
    listening: boolean;
    ts: number;
  } | null;
  power: {
    currentWatts: number | null;
    currentCostPerHourNzd: number | null;
    generatedAt: string | null;
  } | null;
  dashboardState: {
    outsideTemperature: number | null;
    outsideFeelsLike: number | null;
    humidity: number | null;
    rainChancePct: number | null;
    uvIndex: number | null;
    windSpeed: number | null;
    forecastHigh: number | null;
    forecastLow: number | null;
    nextSetting: string | null;
    nextRising: string | null;
    sunState: string | null;
    haHealthy: boolean | null;
    wanConnected: boolean | null;
    lightsOn: number | null;
    openingsOpen: number | null;
    unavailableCount: number | null;
    generatedAt: string | null;
    /** Per-zone resolved environment, for the zone-parameterised modules. */
    zones: Array<{ id: string; name: string; temperatureC: number | null; humidityPct: number | null }>;
    /** Numeric entity readings, keyed by entity id, for `entity-numeric`. */
    numericEntities: Array<{ entityId: string; name: string; value: number | null; unit: string | null }>;
  } | null;
  tasks: {
    /** Hours until the next undismissed reminder is due; null when none. */
    nextDueInHours: number | null;
    nextDueAt: string | null;
    overdueCount: number;
  } | null;
};

export type OrbModule = OrbModuleDefinition & {
  read: (sources: OrbInfoSources, params?: OrbModuleParams) => OrbModuleOutput;
};

function display(overrides: Partial<OrbInfoDisplay>): OrbInfoDisplay {
  return { ...DEFAULT_ORB_DISPLAY, ...overrides };
}

function output(overrides: Partial<OrbModuleOutput>): OrbModuleOutput {
  return { ...ORB_MODULE_OUTPUT_EMPTY, ...overrides };
}

const MS_PER_HOUR = 3_600_000;

/** A finite reading, or the unavailable output when the source has nothing. */
function reading(
  value: number | null | undefined,
  baseUnit: OrbModuleOutput["baseUnit"],
  extra: Partial<OrbModuleOutput> = {},
): OrbModuleOutput {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return output({ baseUnit, status: "unavailable" });
  }
  return output({ value, baseUnit, status: "ok", ...extra });
}

function hoursUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, target - now) / MS_PER_HOUR;
}

export const ORB_INFO_MODULES: OrbModule[] = [
  {
    id: "none",
    label: "None",
    group: "none",
    detail: "Orb with no readout",
    baseUnit: "none",
    sources: [],
    supportedFormats: ["text"],
    defaultDisplay: display({ format: "text", emptyText: "" }),
    read: () => output({ status: "unavailable", text: null }),
  },

  // ---- Cadence -----------------------------------------------------------
  {
    id: "gym",
    label: "Gym — time since visit",
    group: "cadence",
    detail: "Since the last scraped GymMaster visit",
    baseUnit: "hours",
    sources: ["watchface"],
    supportedFormats: ["duration", "number", "percent"],
    defaultDisplay: display({ format: "duration", unit: "hours", decimals: 0, rounding: "floor" }),
    read: ({ watchface, now }) => {
      if (!watchface || watchface.gymLastResetAt === null) {
        return output({ baseUnit: "hours", status: "unavailable", alertThreshold: watchface?.gymAlertThresholdHours ?? null });
      }
      // Fractional hours: the display's rounding mode decides how it reads, so
      // the default (floor, 0dp) reproduces the original whole-hours counter
      // exactly while a 1dp display stays honest.
      const hours = Math.max(0, now - watchface.gymLastResetAt) / MS_PER_HOUR;
      const threshold = watchface.gymAlertThresholdHours;
      return output({
        value: hours,
        baseUnit: "hours",
        status: "ok",
        observedAt: new Date(watchface.gymLastResetAt).toISOString(),
        alert: threshold !== null && hours >= threshold,
        alertThreshold: threshold,
      });
    },
  },
  {
    id: "gym-progress",
    label: "Gym — progress to alert",
    group: "cadence",
    detail: "Percentage of the way to the alert threshold",
    baseUnit: "hours",
    sources: ["watchface"],
    supportedFormats: ["percent", "duration", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "floor", showUnit: true, percentClamp: true }),
    read: (sources) => ORB_INFO_MODULES_BY_ID.gym.read(sources),
  },

  // ---- Host health (already polled by the orb; no new traffic) ------------
  {
    id: "host-cpu",
    label: "Host CPU",
    group: "host",
    detail: "Nova host processor utilisation",
    baseUnit: "percent",
    sources: ["novaLoad"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ novaLoad }) => reading(novaLoad ? novaLoad.cpu * 100 : null, "percent"),
  },
  {
    id: "host-gpu",
    label: "Host GPU",
    group: "host",
    detail: "Nova host graphics utilisation",
    baseUnit: "percent",
    sources: ["novaLoad"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ novaLoad }) => reading(novaLoad ? novaLoad.gpu * 100 : null, "percent"),
  },
  {
    id: "host-network",
    label: "Host network",
    group: "host",
    detail: "Throughput against a ~100 Mbps ceiling",
    baseUnit: "percent",
    sources: ["novaLoad"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ novaLoad }) => reading(novaLoad ? novaLoad.net * 100 : null, "percent"),
  },
  {
    id: "host-load",
    label: "Host load",
    group: "host",
    detail: "The composite load the orb already animates to",
    baseUnit: "percent",
    sources: ["novaLoad"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ novaLoad }) => reading(novaLoad ? novaLoad.load * 100 : null, "percent"),
  },

  // ---- Time & sky --------------------------------------------------------
  {
    id: "clock",
    label: "Current time",
    group: "time",
    detail: "This device's clock",
    baseUnit: "timestamp",
    sources: ["clock"],
    supportedFormats: ["clock"],
    defaultDisplay: display({ format: "clock", clock12Hour: false, clockSeconds: false }),
    read: ({ now }) => output({ value: now, baseUnit: "timestamp", status: "ok" }),
  },
  {
    id: "until-sunset",
    label: "Until sunset",
    group: "time",
    detail: "Time remaining before the sun sets",
    baseUnit: "hours",
    sources: ["dashboardState"],
    supportedFormats: ["duration", "number"],
    defaultDisplay: display({ format: "duration", unit: "auto", decimals: 1, rounding: "floor", showUnit: true }),
    read: ({ dashboardState, now }) => {
      const hours = hoursUntil(dashboardState?.nextSetting ?? null, now);
      return reading(hours, "hours", {
        observedAt: dashboardState?.nextSetting ?? null,
      });
    },
  },
  {
    id: "until-sunrise",
    label: "Until sunrise",
    group: "time",
    detail: "Time remaining before the sun rises",
    baseUnit: "hours",
    sources: ["dashboardState"],
    supportedFormats: ["duration", "number"],
    defaultDisplay: display({ format: "duration", unit: "auto", decimals: 1, rounding: "floor", showUnit: true }),
    read: ({ dashboardState, now }) => {
      const hours = hoursUntil(dashboardState?.nextRising ?? null, now);
      return reading(hours, "hours", {
        observedAt: dashboardState?.nextRising ?? null,
      });
    },
  },
  {
    id: "outside-temperature",
    label: "Outside temperature",
    group: "climate",
    detail: "From the configured weather entity",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.outsideTemperature, "celsius"),
  },
  {
    id: "outside-feels-like",
    label: "Outside feels like",
    group: "climate",
    detail: "Apparent temperature from the weather entity",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.outsideFeelsLike, "celsius"),
  },
  {
    id: "rain-chance",
    label: "Rain chance",
    group: "climate",
    detail: "Forecast probability of precipitation",
    baseUnit: "percent",
    sources: ["dashboardState"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.rainChancePct, "percent"),
  },

  // ---- Power -------------------------------------------------------------
  {
    id: "power-draw",
    label: "Power draw",
    group: "power",
    detail: "Live household usage rate",
    baseUnit: "watts",
    sources: ["power"],
    supportedFormats: ["number", "percent"],
    defaultDisplay: display({ format: "number", unit: "kilowatts", decimals: 2, rounding: "round", showUnit: true }),
    read: ({ power }) => reading(power?.currentWatts, "watts", { observedAt: power?.generatedAt ?? null }),
  },
  {
    id: "power-cost-rate",
    label: "Power cost rate",
    group: "power",
    detail: "Estimated spend per hour at the current tariff",
    baseUnit: "count",
    sources: ["power"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 2, rounding: "round", prefix: "$" }),
    read: ({ power }) => reading(power?.currentCostPerHourNzd, "count", { observedAt: power?.generatedAt ?? null }),
  },

  // ---- Household & system ------------------------------------------------
  {
    id: "lights-on",
    label: "Lights on",
    group: "household",
    detail: "How many lights are currently on",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0 }),
    read: ({ dashboardState }) => reading(dashboardState?.lightsOn, "count"),
  },
  {
    id: "devices-unavailable",
    label: "Devices unavailable",
    group: "system",
    detail: "Entities Home Assistant cannot currently reach",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0 }),
    read: ({ dashboardState }) => {
      const count = dashboardState?.unavailableCount;
      if (count === null || count === undefined || !Number.isFinite(count)) {
        return output({ baseUnit: "count", status: "unavailable" });
      }
      return output({ value: count, baseUnit: "count", status: "ok", alert: count > 0 });
    },
  },
  // ---- Parameterised: a zone, an entity, a date ---------------------------
  {
    id: "zone-temperature",
    label: "Zone temperature",
    group: "climate",
    detail: "Temperature in a chosen room",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    params: [{ key: "zoneId", label: "Room", kind: "zone" }],
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 1, rounding: "round", showUnit: true }),
    read: ({ dashboardState }, params) => {
      const zone = dashboardState?.zones.find((entry) => entry.id === params?.zoneId);
      return reading(zone?.temperatureC, "celsius", { detail: zone ? `In ${zone.name}.` : undefined });
    },
  },
  {
    id: "zone-humidity",
    label: "Zone humidity",
    group: "climate",
    detail: "Humidity in a chosen room",
    baseUnit: "percent",
    sources: ["dashboardState"],
    supportedFormats: ["percent", "number"],
    params: [{ key: "zoneId", label: "Room", kind: "zone" }],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }, params) => {
      const zone = dashboardState?.zones.find((entry) => entry.id === params?.zoneId);
      return reading(zone?.humidityPct, "percent", { detail: zone ? `In ${zone.name}.` : undefined });
    },
  },
  {
    id: "indoor-outdoor-delta",
    label: "Indoor vs outdoor",
    group: "climate",
    detail: "How much warmer a room is than outside",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    params: [{ key: "zoneId", label: "Room", kind: "zone" }],
    // Signed by default: the sign IS the answer to "should I open a window".
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 1, rounding: "round", showUnit: true, signed: true }),
    read: ({ dashboardState }, params) => {
      const zone = dashboardState?.zones.find((entry) => entry.id === params?.zoneId);
      const inside = zone?.temperatureC;
      const outside = dashboardState?.outsideTemperature;
      if (inside === null || inside === undefined || outside === null || outside === undefined) {
        return output({ baseUnit: "celsius", status: "unavailable" });
      }
      return output({
        value: inside - outside,
        baseUnit: "celsius",
        status: "ok",
        detail: zone ? `${zone.name} compared with outside.` : undefined,
      });
    },
  },
  {
    id: "entity-numeric",
    label: "Any sensor",
    group: "household",
    detail: "The value of any numeric Home Assistant sensor",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number", "percent", "temperature", "duration"],
    params: [{ key: "entityId", label: "Sensor", kind: "entity", domain: "sensor" }],
    defaultDisplay: display({ format: "number", decimals: 1, rounding: "round" }),
    read: ({ dashboardState }, params) => {
      const entity = dashboardState?.numericEntities.find((item) => item.entityId === params?.entityId);
      if (!entity) {
        return output({ baseUnit: "count", status: "unavailable" });
      }
      // The base unit follows the sensor: a °C sensor must convert like a
      // temperature, a % sensor must read as a percentage already.
      const unit = (entity.unit ?? "").toLowerCase();
      const baseUnit = unit.includes("°c") || unit === "c" ? "celsius"
        : unit === "%" ? "percent"
        : unit === "w" ? "watts"
        : unit === "h" ? "hours"
        : "count";
      return reading(entity.value, baseUnit, { detail: entity.name });
    },
  },
  {
    id: "since-date",
    label: "Time since a date",
    group: "cadence",
    detail: "A streak counter from any date you choose",
    baseUnit: "hours",
    sources: ["clock"],
    supportedFormats: ["duration", "number", "percent"],
    params: [
      { key: "since", label: "Since", kind: "date" },
      { key: "alertAfterDays", label: "Alert After Days", kind: "number", min: 0, max: 365, step: 1, fallback: 0 },
    ],
    defaultDisplay: display({ format: "duration", unit: "days", decimals: 0, rounding: "floor", showUnit: true }),
    read: ({ now }, params) => {
      const since = typeof params?.since === "string" ? Date.parse(params.since) : NaN;
      if (!Number.isFinite(since)) {
        return output({ baseUnit: "hours", status: "unavailable" });
      }
      const hours = Math.max(0, now - since) / MS_PER_HOUR;
      const alertAfterDays = Number(params?.alertAfterDays);
      // 0 (the fallback) means "never alert" rather than "alert immediately".
      const threshold = Number.isFinite(alertAfterDays) && alertAfterDays > 0 ? alertAfterDays * 24 : null;
      return output({
        value: hours,
        baseUnit: "hours",
        status: "ok",
        observedAt: new Date(since).toISOString(),
        alert: threshold !== null && hours >= threshold,
        alertThreshold: threshold,
      });
    },
  },

  // ---- Reminders ----------------------------------------------------------
  {
    id: "next-reminder",
    label: "Next reminder",
    group: "cadence",
    detail: "Time until the next reminder is due",
    baseUnit: "hours",
    sources: ["tasks"],
    supportedFormats: ["duration", "number"],
    defaultDisplay: display({ format: "duration", unit: "auto", decimals: 0, rounding: "floor", showUnit: true }),
    read: ({ tasks }) => reading(tasks?.nextDueInHours, "hours", { observedAt: tasks?.nextDueAt ?? null }),
  },
  {
    id: "reminders-overdue",
    label: "Overdue reminders",
    group: "cadence",
    detail: "How many reminders are past due",
    baseUnit: "count",
    sources: ["tasks"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0 }),
    read: ({ tasks }) => {
      if (!tasks) return output({ baseUnit: "count", status: "unavailable" });
      return output({ value: tasks.overdueCount, baseUnit: "count", status: "ok", alert: tasks.overdueCount > 0 });
    },
  },

  // ---- More sky -----------------------------------------------------------
  {
    id: "outside-humidity",
    label: "Outside humidity",
    group: "climate",
    detail: "Humidity from the weather entity",
    baseUnit: "percent",
    sources: ["dashboardState"],
    supportedFormats: ["percent", "number"],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.humidity, "percent"),
  },
  {
    id: "uv-index",
    label: "UV index",
    group: "climate",
    detail: "Current UV index",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0, rounding: "round" }),
    read: ({ dashboardState }) => reading(dashboardState?.uvIndex, "count"),
  },
  {
    id: "wind-speed",
    label: "Wind speed",
    group: "climate",
    detail: "Current wind speed",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0, rounding: "round" }),
    read: ({ dashboardState }) => reading(dashboardState?.windSpeed, "count"),
  },
  {
    id: "forecast-high",
    label: "Forecast high",
    group: "climate",
    detail: "Today's forecast maximum",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.forecastHigh, "celsius"),
  },
  {
    id: "forecast-low",
    label: "Forecast low",
    group: "climate",
    detail: "Today's forecast minimum",
    baseUnit: "celsius",
    sources: ["dashboardState"],
    supportedFormats: ["temperature", "number"],
    defaultDisplay: display({ format: "temperature", unit: "celsius", decimals: 0, rounding: "round", showUnit: true }),
    read: ({ dashboardState }) => reading(dashboardState?.forecastLow, "celsius"),
  },

  // ---- More household & system --------------------------------------------
  {
    id: "openings-open",
    label: "Doors & windows open",
    group: "household",
    detail: "How many covers are currently open",
    baseUnit: "count",
    sources: ["dashboardState"],
    supportedFormats: ["number"],
    defaultDisplay: display({ format: "number", decimals: 0 }),
    read: ({ dashboardState }) => {
      const count = dashboardState?.openingsOpen;
      if (count === null || count === undefined) return output({ baseUnit: "count", status: "unavailable" });
      return output({ value: count, baseUnit: "count", status: "ok", alert: count > 0 });
    },
  },
  {
    id: "power-headroom",
    label: "Power headroom",
    group: "power",
    detail: "Draw as a percentage of a ceiling you set",
    baseUnit: "watts",
    sources: ["power"],
    supportedFormats: ["percent", "number"],
    params: [{ key: "ceilingWatts", label: "Ceiling Watts", kind: "number", min: 500, max: 15000, step: 100, fallback: 5000 }],
    defaultDisplay: display({ format: "percent", decimals: 0, rounding: "round", showUnit: true, percentClamp: false }),
    read: ({ power }, params) => {
      const ceiling = Number(params?.ceilingWatts);
      const threshold = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null;
      const watts = power?.currentWatts;
      if (watts === null || watts === undefined || !Number.isFinite(watts)) {
        return output({ baseUnit: "watts", status: "unavailable", alertThreshold: threshold });
      }
      return output({
        value: watts,
        baseUnit: "watts",
        status: "ok",
        observedAt: power?.generatedAt ?? null,
        alert: threshold !== null && watts >= threshold,
        alertThreshold: threshold,
      });
    },
  },
  {
    id: "wan-status",
    label: "Internet connection",
    group: "system",
    detail: "Whether the router's WAN link is up",
    baseUnit: "none",
    sources: ["dashboardState"],
    supportedFormats: ["text"],
    defaultDisplay: display({ format: "text" }),
    read: ({ dashboardState }) => {
      const connected = dashboardState?.wanConnected;
      if (connected === null || connected === undefined) {
        return output({ baseUnit: "none", status: "unavailable" });
      }
      return output({
        baseUnit: "none",
        status: "ok",
        text: connected ? "UP" : "DOWN",
        alert: !connected,
        detail: connected ? undefined : "The internet connection is down.",
      });
    },
  },
  {
    id: "ha-health",
    label: "Home Assistant health",
    group: "system",
    detail: "Whether the HA snapshot is live or degraded",
    baseUnit: "none",
    sources: ["dashboardState"],
    supportedFormats: ["text"],
    defaultDisplay: display({ format: "text", emptyText: "—" }),
    read: ({ dashboardState }) => {
      if (!dashboardState || dashboardState.haHealthy === null) {
        return output({ baseUnit: "none", status: "unavailable" });
      }
      return output({
        baseUnit: "none",
        status: "ok",
        text: dashboardState.haHealthy ? "OK" : "DEG",
        alert: !dashboardState.haHealthy,
        detail: dashboardState.haHealthy ? undefined : "Home Assistant state is degraded.",
      });
    },
  },
];

export const ORB_INFO_MODULES_BY_ID: Record<string, OrbModule> = Object.fromEntries(
  ORB_INFO_MODULES.map((module) => [module.id, module]),
);

export const DEFAULT_ORB_MODULE_ID = "gym";

export function orbModuleById(id: string | undefined): OrbModule {
  return ORB_INFO_MODULES_BY_ID[id ?? ""] ?? ORB_INFO_MODULES_BY_ID[DEFAULT_ORB_MODULE_ID];
}

export const ORB_MODULE_GROUP_LABELS: Record<OrbModuleDefinition["group"], string> = {
  none: "Off",
  cadence: "Cadence",
  host: "Host",
  time: "Time & Sky",
  climate: "Climate",
  power: "Power",
  household: "Household",
  system: "System",
};
