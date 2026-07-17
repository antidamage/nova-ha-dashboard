import crypto from "crypto";
import path from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { callService, haRest } from "./ha";
import type { HaState } from "./types";
import { readDashboardConfigSync } from "./dashboard-config";

const TIME_ZONE = "Pacific/Auckland";
const SAMPLE_INTERVAL_MS = 30_000;
const HA_PUBLISH_INTERVAL_MS = 60_000;
const DISCOVERY_INTERVAL_MS = 24 * 60 * 60_000;
const RATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
const MAX_INTEGRATION_HOURS = 2;
const BILLING_END_DAY = 18;
const BILLING_START_DAY = 19;
const POWER_DATA_DIR = process.env.NOVA_DASHBOARD_POWER_DATA ?? path.join(process.cwd(), "data", "power");
const POWER_STATE_PATH = path.join(POWER_DATA_DIR, "state.json");
const POWER_RATINGS_PATH = path.join(POWER_DATA_DIR, "device-ratings.json");
const POWER_ACCOUNT_USAGE_PATH = path.join(POWER_DATA_DIR, "account-usage.json");
const POWERSHOP_RATES_PAGE = "https://www.powershop.co.nz/our-rates/";
const POWERSHOP_AUCKLAND_RATECARD = "https://www.powershop.co.nz/public/Ratecards/2026/03-Auckland-Central-South.pdf";

function powerConfig() {
  return readDashboardConfigSync().power;
}

type DeviceKind = "light" | "switch" | "climate";
type TariffPeriod = "anytime" | "peak" | "off_peak";

export type PowerDeviceRating = {
  aliases?: string[];
  confidence: "measured" | "high" | "medium" | "manual" | "assumed";
  coolInputWatts?: number;
  entityIds: string[];
  heatInputWatts?: number;
  id: string;
  kind: DeviceKind;
  manufacturer?: string;
  maxWatts?: number;
  model?: string;
  name: string;
  notes?: string;
  powerSensorEntityId?: string;
  ratedWatts: number;
  source: string;
  sourceUrl?: string;
  standbyWatts?: number;
  zone: string;
};

export type PowerDeviceReading = {
  confidence: PowerDeviceRating["confidence"];
  entityId: string | null;
  id: string;
  kwhTotal: number;
  name: string;
  notes?: string;
  ratedWatts: number;
  source: string;
  state: string;
  watts: number;
  zone: string;
};

export type PowerPeriodSummary = {
  costNzd: number;
  kwh: number;
  projectedCostNzd?: number;
  projectedKwh?: number;
};

export type PowerPoint = {
  costNzd: number;
  kwh: number;
  label: string;
};

export type PowerRatePoint = {
  cPerKwh: number;
  label: string;
};

export type PowerAccountUsagePoint = {
  avgUnitCents?: number;
  costNzd?: number;
  costPerDayNzd?: number;
  days?: number;
  kwh: number;
  kwhPerDay?: number;
  label: string;
  source: string;
};

export type PowerBackgroundEstimatePoint = {
  computerKwh: number;
  fridgeKwh: number;
  label: string;
  novaKwh: number;
  otherKwh: number;
  totalKwh: number;
  waterHeaterKwh: number;
};

export type PowerModeledLoad = {
  costPerDayNzd: number;
  currentWatts: number;
  elapsedCostNzd: number;
  elapsedKwh: number;
  id: string;
  kwhPerDay: number;
  name: string;
  notes: string;
};

export type PowerBaseLoadSummary = {
  costPerDayNzd: number;
  currentWatts: number;
  devices: PowerModeledLoad[];
  elapsedCostNzd: number;
  elapsedKwh: number;
  fixedCostPerDayNzd: number;
  kwhPerDay: number;
  usageCostPerDayNzd: number;
};

export type PowerDashboard = {
  baseLoad: PowerBaseLoadSummary;
  billingCycle: {
    day: number;
    days: number;
    endDate: string;
    label: string;
    startDate: string;
  };
  currentCostPerHourNzd: number;
  currentRate: {
    cPerKwh: number;
    dailyCents: number;
    displayName: string;
    period: TariffPeriod;
    sourceUrl: string;
  };
  currentWatts: number;
  devices: PowerDeviceReading[];
  generatedAt: string;
  graph: PowerPoint[];
  accountUsageGraph: PowerAccountUsagePoint[];
  accountRateGraph: PowerRatePoint[];
  backgroundEstimateGraph: PowerBackgroundEstimatePoint[];
  lastRateCheckAt: string | null;
  lastSampleAt: string | null;
  rateGraph: PowerRatePoint[];
  ratesWarning?: string;
  summaries: {
    day: PowerPeriodSummary;
    month: PowerPeriodSummary;
    week: PowerPeriodSummary;
    yearToDate: PowerPeriodSummary;
  };
  totals: {
    costNzd: number;
    kwh: number;
  };
};

type PowerBucket = {
  costNzd: number;
  kwh: number;
};

type PersistedDeviceState = {
  kwhTotal: number;
  lastEntityId: string | null;
  lastState: string;
  lastWatts: number;
  updatedAt: string;
};

type RateCheck = {
  checkedAt: string;
  ok: boolean;
  pageHash?: string;
  pdfHash?: string;
  sourceUrl: string;
  warning?: string;
};

type PowerState = {
  daily: Record<string, PowerBucket>;
  devices: Record<string, PersistedDeviceState>;
  hourly: Record<string, PowerBucket>;
  lastRateCheck?: RateCheck;
  lastSampleAt: string | null;
  rateHistory: Array<{ at: string; cPerKwh: number; label: string }>;
  version: 1;
};

const aucklandFormatter = new Intl.DateTimeFormat("en-NZ", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: TIME_ZONE,
  weekday: "short",
  year: "numeric",
});

const monthWeights = [0.78, 0.76, 0.82, 0.94, 1.12, 1.25, 1.32, 1.2, 1.05, 0.93, 0.84, 0.79];
const aucklandMonthlyTempsC = [20.3, 20.6, 19.4, 17.2, 14.8, 12.8, 11.8, 12.5, 14.0, 15.7, 17.4, 19.1];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const desktopOnStartHour = 8;
const desktopOnEndHour = 22.5;
const desktopActiveWatts = 285;
const desktopStandbyWatts = 6;
const novaAioAverageWatts = 42;

const powershopStandardUserStandardAnytime = [
  25.88, 26.42, 28.08, 29.46, 29.46, 29.46, 29.46, 28.95, 27.62, 26.75, 26.2, 25.88,
];
const powershopStandardUserStandardAnytime2025 = [
  22.77, 23.31, 24.98, 26.36, 26.36, 26.36, 26.36, 25.84, 24.52, 23.64, 23.09, 22.77,
];
const powershopStandardUserStandardPeak = [
  23.25, 23.79, 25.46, 41.18, 41.18, 41.18, 41.18, 40.66, 39.34, 24.13, 23.58, 23.25,
];
const powershopStandardUserStandardOffPeak = [
  23.25, 23.79, 25.46, 26.84, 26.84, 26.84, 26.84, 26.32, 25.0, 24.13, 23.58, 23.25,
];

const defaultAccountUsage: PowerAccountUsagePoint[] = [
  { label: "May 2024", days: 30, kwh: 903, kwhPerDay: 30.1, costNzd: 307.14, costPerDayNzd: 10.24, avgUnitCents: 34.01, source: "Powershop account table" },
  { label: "Jun 2024", days: 31, kwh: 1031, kwhPerDay: 33.3, costNzd: 340.29, costPerDayNzd: 10.98, avgUnitCents: 33.01, source: "Powershop account table" },
  { label: "Jul 2024", days: 30, kwh: 1122, kwhPerDay: 37.4, costNzd: 361.32, costPerDayNzd: 12.04, avgUnitCents: 32.2, source: "Powershop account table" },
  { label: "Aug 2024", days: 31, kwh: 1193, kwhPerDay: 38.5, costNzd: 379.47, costPerDayNzd: 12.24, avgUnitCents: 31.81, source: "Powershop account table" },
  { label: "Sep 2024", days: 31, kwh: 996, kwhPerDay: 32.1, costNzd: 321.1, costPerDayNzd: 10.36, avgUnitCents: 32.24, source: "Powershop account table" },
  { label: "Oct 2024", days: 30, kwh: 916, kwhPerDay: 30.5, costNzd: 274.62, costPerDayNzd: 9.15, avgUnitCents: 29.98, source: "Powershop account table" },
  { label: "Nov 2024", days: 31, kwh: 731, kwhPerDay: 23.6, costNzd: 220.35, costPerDayNzd: 7.11, avgUnitCents: 30.14, source: "Powershop account table" },
  { label: "Dec 2024", days: 30, kwh: 636, kwhPerDay: 21.2, costNzd: 186.49, costPerDayNzd: 6.22, avgUnitCents: 29.32, source: "Powershop account table" },
  { label: "Jan 2025", days: 31, kwh: 581, kwhPerDay: 18.7, costNzd: 187.69, costPerDayNzd: 6.05, avgUnitCents: 32.3, source: "Powershop account table" },
  { label: "Feb 2025", days: 31, kwh: 653, kwhPerDay: 21.1, costNzd: 202.96, costPerDayNzd: 6.55, avgUnitCents: 31.08, source: "Powershop account table" },
  { label: "Mar 2025", days: 28, kwh: 643, kwhPerDay: 23.0, costNzd: 201.67, costPerDayNzd: 7.2, avgUnitCents: 31.36, source: "Powershop account table" },
  { label: "Apr 2025", days: 31, kwh: 714, kwhPerDay: 23.0, costNzd: 244.96, costPerDayNzd: 7.9, avgUnitCents: 34.31, source: "Powershop account table" },
  { label: "May 2025", days: 30, kwh: 655, kwhPerDay: 21.8, costNzd: 270.95, costPerDayNzd: 9.03, avgUnitCents: 41.37, source: "Powershop account table" },
  { label: "Jun 2025", days: 31, kwh: 774, kwhPerDay: 25.0, costNzd: 303.37, costPerDayNzd: 9.79, avgUnitCents: 39.2, source: "Powershop account table" },
  { label: "Jul 2025", days: 30, kwh: 938, kwhPerDay: 31.3, costNzd: 324.55, costPerDayNzd: 10.82, avgUnitCents: 34.6, source: "Powershop account table" },
  { label: "Aug 2025", days: 31, kwh: 1112, kwhPerDay: 35.9, costNzd: 368.91, costPerDayNzd: 11.9, avgUnitCents: 33.18, source: "Powershop account table" },
  { label: "Sep 2025", days: 31, kwh: 940, kwhPerDay: 30.3, costNzd: 338.43, costPerDayNzd: 10.92, avgUnitCents: 36.0, source: "Powershop account table" },
  { label: "Oct 2025", days: 30, kwh: 845, kwhPerDay: 28.2, costNzd: 264.25, costPerDayNzd: 8.81, avgUnitCents: 31.27, source: "Powershop account table" },
  { label: "Nov 2025", days: 31, kwh: 765, kwhPerDay: 24.7, costNzd: 232.29, costPerDayNzd: 7.49, avgUnitCents: 30.36, source: "Powershop account table" },
  { label: "Dec 2025", days: 30, kwh: 756, kwhPerDay: 25.2, costNzd: 225.37, costPerDayNzd: 7.51, avgUnitCents: 29.81, source: "Powershop account table" },
  { label: "Jan 2026", days: 32, kwh: 777, kwhPerDay: 24.3, costNzd: 248.7, costPerDayNzd: 7.77, avgUnitCents: 32.01, source: "Powershop account table" },
  { label: "Feb 2026", days: 30, kwh: 800, kwhPerDay: 26.7, costNzd: 238.31, costPerDayNzd: 7.94, avgUnitCents: 29.79, source: "Powershop account table" },
  { label: "Mar 2026", days: 28, kwh: 708, kwhPerDay: 25.3, costNzd: 215.35, costPerDayNzd: 7.69, avgUnitCents: 30.42, source: "Powershop account table" },
  { label: "Apr 2026", days: 28, kwh: 708, kwhPerDay: 25.3, costNzd: 256.24, costPerDayNzd: 9.15, avgUnitCents: 36.19, source: "Powershop account table" },
];

const defaultRatings: PowerDeviceRating[] = [
  {
    id: "neon_lights",
    name: "Neon Lights",
    zone: "Lounge",
    kind: "light",
    entityIds: [
      "light.cupboard_socket_1",
      "switch.cupboard_outlet_1",
      "switch.cupboard_socket_1",
      "light.tuya_mobile_neon_lights",
    ],
    ratedWatts: 30,
    standbyWatts: 0.3,
    confidence: "manual",
    source: "User supplied: 0.03 kW",
  },
  {
    id: "lounge_lifx",
    name: "Lounge light",
    zone: "Lounge",
    kind: "light",
    entityIds: ["light.lounge_light"],
    ratedWatts: 15.5,
    standbyWatts: 0.2,
    confidence: "high",
    manufacturer: "LIFX",
    model: "A21 1600lm",
    source: "LIFX A21 1600lm specification",
  },
  {
    id: "bedroom_lifx",
    name: "Bedroom light",
    zone: "Bedroom",
    kind: "light",
    entityIds: ["light.bedroom_light"],
    ratedWatts: 15.5,
    standbyWatts: 0.2,
    confidence: "high",
    manufacturer: "LIFX",
    model: "A21 1600lm",
    source: "LIFX A21 1600lm specification",
  },
  {
    id: "conservatory_lifx",
    name: "Conservatory light",
    zone: "Conservatory",
    kind: "light",
    entityIds: ["light.conservatory_light"],
    ratedWatts: 15.5,
    standbyWatts: 0.2,
    confidence: "high",
    manufacturer: "LIFX",
    model: "A21 1600lm",
    source: "LIFX A21 1600lm specification",
  },
  {
    id: "kitchen_tapo_l530",
    name: "Kitchen light 1",
    zone: "Kitchen",
    kind: "light",
    entityIds: ["light.kitchen_light_1"],
    ratedWatts: 8.8,
    standbyWatts: 0.4,
    confidence: "high",
    manufacturer: "TP-Link Tapo",
    model: "L530",
    source: "TP-Link Tapo L530 specification",
  },
  {
    id: "hallway_tapo_l530",
    name: "Hallway 2",
    zone: "Conservatory",
    kind: "light",
    entityIds: ["light.hallway_2"],
    ratedWatts: 8.8,
    standbyWatts: 0.4,
    confidence: "high",
    manufacturer: "TP-Link Tapo",
    model: "L530",
    source: "TP-Link Tapo L530 specification",
  },
  {
    id: "wardrobe_tapo_l530",
    name: "Wardrobe",
    zone: "Bedroom",
    kind: "light",
    entityIds: ["light.wardrobe"],
    ratedWatts: 8.8,
    standbyWatts: 0.4,
    confidence: "high",
    manufacturer: "TP-Link Tapo",
    model: "L530",
    source: "TP-Link Tapo L530 specification",
  },
  {
    id: "desk_tapo_l535",
    name: "Desk",
    zone: "Lounge",
    kind: "light",
    entityIds: ["light.desk"],
    ratedWatts: 8.6,
    standbyWatts: 0.4,
    confidence: "high",
    manufacturer: "TP-Link Tapo",
    model: "L535E",
    source: "TP-Link Tapo L535E specification",
  },
  {
    id: "hallway_tuya_bulb",
    name: "Hallway light",
    zone: "Lounge",
    kind: "light",
    entityIds: ["light.tuya_mobile_hallway_light", "light.hallway_light"],
    ratedWatts: 10,
    standbyWatts: 0.5,
    confidence: "assumed",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "RGB bulb",
    source: "User supplied: Kogan RGB bulbs are 9-10W",
  },
  {
    id: "nook_tuya_bulb",
    name: "Nook light",
    zone: "Kitchen",
    kind: "light",
    entityIds: ["light.tuya_mobile_nook_light", "light.nook_light"],
    ratedWatts: 10,
    standbyWatts: 0.5,
    confidence: "assumed",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "RGB bulb",
    source: "User supplied: Kogan RGB bulbs are 9-10W",
  },
  {
    id: "outside_tuya_bulb",
    name: "Outside light",
    zone: "Outside",
    kind: "light",
    entityIds: ["light.tuya_mobile_outside_light", "light.outside_light"],
    ratedWatts: 10,
    standbyWatts: 0.5,
    confidence: "assumed",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "RGB bulb",
    source: "User supplied: Kogan RGB bulbs are 9-10W",
  },
  {
    id: "kitchen_tuya_bulb_a",
    name: "Kitchen light 2",
    zone: "Kitchen",
    kind: "light",
    entityIds: ["light.tuya_mobile_kitchen_light_2", "light.kitchen_light_2"],
    ratedWatts: 10,
    standbyWatts: 0.5,
    confidence: "assumed",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "RGB bulb",
    source: "User supplied: Kogan RGB bulbs are 9-10W",
  },
  {
    id: "kitchen_tuya_bulb_b",
    name: "Kitchen light 2 2",
    zone: "Kitchen",
    kind: "light",
    entityIds: ["light.tuya_mobile_kitchen_light_2_2", "light.kitchen_light_2_2"],
    ratedWatts: 10,
    standbyWatts: 0.5,
    confidence: "assumed",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "RGB bulb",
    source: "User supplied: Kogan RGB bulbs are 9-10W",
  },
  {
    id: "mirror_flood",
    name: "Mirror light",
    zone: "Lounge",
    kind: "light",
    entityIds: ["light.tuya_mobile_mirror_light", "light.mirror_top", "light.mirror_light"],
    ratedWatts: 20,
    standbyWatts: 0.5,
    confidence: "high",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "20W RGB + CCT LED Flood Light",
    source: "HA device model: Kogan SmarterHome 20W flood light",
  },
  {
    id: "tv_flood",
    name: "TV light",
    zone: "Lounge",
    kind: "light",
    entityIds: ["light.tuya_mobile_tv_light", "light.mirror_bottom", "light.tv_light"],
    ratedWatts: 20,
    standbyWatts: 0.5,
    confidence: "high",
    manufacturer: "Kogan SmarterHome / Tuya",
    model: "20W RGB + CCT LED Flood Light",
    source: "HA device model: Kogan SmarterHome 20W flood light",
  },
  {
    id: "panel_heater",
    name: "Panel Heater",
    zone: "Climate",
    kind: "climate",
    entityIds: ["climate.panel_heater_2", "climate.panel_heater"],
    ratedWatts: 2000,
    standbyWatts: 1.5,
    confidence: "assumed",
    manufacturer: "Kogan / Goldair",
    model: "Glass panel heater",
    source: "User supplied: probably 2kW",
  },
  {
    id: "gree_aircon",
    name: "Air Conditioner",
    zone: "Climate",
    kind: "climate",
    entityIds: ["climate.c6780cad"],
    ratedWatts: 1520,
    coolInputWatts: 1370,
    heatInputWatts: 1520,
    maxWatts: 2330,
    standbyWatts: 15,
    confidence: "high",
    manufacturer: "Gree",
    model: "GWH18AAD-K6DNA1D/I",
    source: "Gree Bora GWH18AAD-K6DNA1D specification and unit label",
    notes: "5.2kW cooling and 5.6kW heating are output capacity; temp sensor is disconnected, so estimate treats compressor modes as on/off until repaired.",
  },
];

const globalPower = globalThis as typeof globalThis & {
  __novaPower?: {
    discoveryPublishedAt: number;
    haPublishedAt: number;
    monitorStarted: boolean;
    samplePromise: Promise<PowerDashboard> | null;
    timer: ReturnType<typeof setInterval> | null;
  };
};

const powerRuntime =
  globalPower.__novaPower ??
  (globalPower.__novaPower = {
    discoveryPublishedAt: 0,
    haPublishedAt: 0,
    monitorStarted: false,
    samplePromise: null,
    timer: null,
  });

function blankState(): PowerState {
  return {
    daily: {},
    devices: {},
    hourly: {},
    lastSampleAt: null,
    rateHistory: [],
    version: 1,
  };
}

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function localParts(date: Date) {
  const parts = Object.fromEntries(aucklandFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    weekday: String(parts.weekday),
    year: Number(parts.year),
  };
}

function dateKeyFromParts(parts: ReturnType<typeof localParts>) {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day
    .toString()
    .padStart(2, "0")}`;
}

function hourKeyFromParts(parts: ReturnType<typeof localParts>) {
  return `${dateKeyFromParts(parts)}T${parts.hour.toString().padStart(2, "0")}`;
}

function dateKeyFromUtc(date: Date) {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function monthFromLabel(label: string) {
  const [monthName, yearText] = label.split(/\s+/);
  const monthIndex = monthNames.indexOf(monthName);
  const year = Number(yearText);
  if (monthIndex < 0 || !Number.isFinite(year)) {
    return null;
  }
  return { monthIndex, year };
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function billingCycleFor(parts: ReturnType<typeof localParts>, localUtc: Date, dayFraction: number) {
  const billingConfig = powerConfig().billing;
  const billingEndDay = billingConfig.endDay || BILLING_END_DAY;
  const billingStartDay = billingConfig.startDay || BILLING_START_DAY;
  const billingEnd = new Date(Date.UTC(parts.year, parts.month - 1 + (parts.day > billingEndDay ? 1 : 0), billingEndDay));
  const billingStart = new Date(Date.UTC(billingEnd.getUTCFullYear(), billingEnd.getUTCMonth() - 1, billingStartDay));
  const billingDays = Math.round((billingEnd.getTime() - billingStart.getTime()) / 86_400_000) + 1;
  const billingElapsedDays = Math.max(
    0,
    Math.min(billingDays, (localUtc.getTime() - billingStart.getTime()) / 86_400_000 + dayFraction),
  );

  return {
    billingDays,
    billingElapsedDays,
    billingEnd,
    billingEndKey: dateKeyFromUtc(billingEnd),
    billingFraction: billingElapsedDays / billingDays,
    billingLabel: `${monthNames[billingEnd.getUTCMonth()]} ${billingEnd.getUTCFullYear()}`,
    billingStart,
    billingStartKey: dateKeyFromUtc(billingStart),
  };
}

function currentKeys(date: Date) {
  const parts = localParts(date);
  const dateKey = dateKeyFromParts(parts);
  const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  const localUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekStart = new Date(localUtc);
  weekStart.setUTCDate(localUtc.getUTCDate() - Math.max(0, weekdayIndex));
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const yearStart = new Date(Date.UTC(parts.year, 0, 1));
  const dayOfYear = Math.floor((localUtc.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const daysInYear = new Date(Date.UTC(parts.year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  const dayFraction = (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86_400;
  const billing = billingCycleFor(parts, localUtc, dayFraction);

  return {
    billingDays: billing.billingDays,
    billingElapsedDays: billing.billingElapsedDays,
    billingEnd: billing.billingEndKey,
    billingEndUtc: billing.billingEnd,
    billingFraction: billing.billingFraction,
    billingLabel: billing.billingLabel,
    billingStart: billing.billingStartKey,
    billingStartUtc: billing.billingStart,
    dateKey,
    day: parts.day,
    dayFraction,
    daysInMonth,
    daysInYear,
    hourKey: hourKeyFromParts(parts),
    month: parts.month,
    monthFraction: ((parts.day - 1) + dayFraction) / daysInMonth,
    monthStart: `${parts.year}-${parts.month.toString().padStart(2, "0")}-01`,
    today: dateKey,
    weekFraction: ((weekdayIndex < 0 ? 0 : weekdayIndex) + dayFraction) / 7,
    weekStart: dateKeyFromUtc(weekStart),
    year: parts.year,
    yearDay: dayOfYear,
    yearFraction: ((dayOfYear - 1) + dayFraction) / daysInYear,
    yearStart: `${parts.year}-01-01`,
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readRatings() {
  let overrides: Partial<PowerDeviceRating>[] | null = null;
  try {
    overrides = JSON.parse(await readFile(POWER_RATINGS_PATH, "utf8")) as Partial<PowerDeviceRating>[];
  } catch {
    await writeJsonAtomic(POWER_RATINGS_PATH, defaultRatings);
    overrides = [];
  }
  const byId = new Map(defaultRatings.map((rating) => [rating.id, rating]));
  for (const override of overrides ?? []) {
    if (!override.id) {
      continue;
    }
    byId.set(override.id, { ...(byId.get(override.id) ?? defaultRatings[0]), ...override } as PowerDeviceRating);
  }
  return Array.from(byId.values());
}

async function readAccountUsage() {
  try {
    const usage = JSON.parse(await readFile(POWER_ACCOUNT_USAGE_PATH, "utf8")) as PowerAccountUsagePoint[];
    return usage
      .filter((point) => typeof point.label === "string" && Number.isFinite(Number(point.kwh)))
      .map((point) => ({
        ...point,
        avgUnitCents: Number.isFinite(Number(point.avgUnitCents)) ? round(Number(point.avgUnitCents), 2) : undefined,
        costNzd: Number.isFinite(Number(point.costNzd)) ? round(Number(point.costNzd), 2) : undefined,
        costPerDayNzd: Number.isFinite(Number(point.costPerDayNzd)) ? round(Number(point.costPerDayNzd), 2) : undefined,
        days: Number.isFinite(Number(point.days)) ? Number(point.days) : undefined,
        kwh: round(Number(point.kwh), 1),
        kwhPerDay: Number.isFinite(Number(point.kwhPerDay)) ? round(Number(point.kwhPerDay), 1) : undefined,
        source: point.source ?? "custom",
      }));
  } catch {
    await writeJsonAtomic(POWER_ACCOUNT_USAGE_PATH, defaultAccountUsage);
    return defaultAccountUsage;
  }
}

function stateIsLive(state?: HaState) {
  return Boolean(state && !["unknown", "unavailable"].includes(String(state.state)));
}

function firstLiveState(statesById: Map<string, HaState>, entityIds: string[]) {
  return entityIds.map((entityId) => statesById.get(entityId)).find(stateIsLive) ?? statesById.get(entityIds[0]);
}

function numericState(statesById: Map<string, HaState>, entityId?: string) {
  if (!entityId) {
    return null;
  }
  const value = Number(statesById.get(entityId)?.state);
  return Number.isFinite(value) ? value : null;
}

function brightnessFactor(state: HaState) {
  const brightness = Number(state.attributes?.brightness);
  if (!Number.isFinite(brightness)) {
    return 1;
  }
  return Math.max(0.08, Math.min(1, brightness / 255));
}

function colorFactor(state: HaState) {
  const rgb = state.attributes?.rgb_color;
  if (!Array.isArray(rgb) || rgb.length < 3) {
    return 1;
  }
  const values = rgb.slice(0, 3).map(Number).filter(Number.isFinite);
  if (values.length < 3) {
    return 1;
  }
  const max = Math.max(...values, 1);
  const whiteMix = values.reduce((sum, value) => sum + value, 0) / (3 * max);
  return Math.max(0.62, Math.min(1, 0.62 + whiteMix * 0.38));
}

function climateWatts(rating: PowerDeviceRating, state: HaState) {
  if (state.state === "off") {
    return rating.standbyWatts ?? 0;
  }
  if (!stateIsLive(state)) {
    return 0;
  }

  const mode = String(state.state);
  if (mode === "fan_only") {
    return Math.min(120, rating.ratedWatts * 0.08);
  }
  if (mode === "dry") {
    return Math.min(rating.ratedWatts, 550);
  }

  if (rating.id === "gree_aircon") {
    return mode === "cool" ? rating.coolInputWatts ?? rating.ratedWatts : rating.heatInputWatts ?? rating.ratedWatts;
  }

  const target = Number(state.attributes?.temperature);
  const current = Number(state.attributes?.current_temperature);
  const hasTemperatures = Number.isFinite(target) && Number.isFinite(current);
  const rawDelta =
    mode === "cool"
      ? hasTemperatures
        ? current - target
        : 1
      : hasTemperatures
        ? target - current
        : 1;

  const load = hasTemperatures ? Math.max(0.25, Math.min(1, 0.28 + Math.max(0, rawDelta) * 0.22)) : 0.55;
  const rated = mode === "cool" ? rating.coolInputWatts ?? rating.ratedWatts : rating.heatInputWatts ?? rating.ratedWatts;
  const watts = Math.max(rating.standbyWatts ?? 0, rated * load);

  if (rating.id === "panel_heater" && hasTemperatures && rawDelta <= 0) {
    return 120;
  }

  return Math.min(rating.maxWatts ?? rating.ratedWatts, watts);
}

function estimateDevice(rating: PowerDeviceRating, statesById: Map<string, HaState>, persisted?: PersistedDeviceState): PowerDeviceReading {
  const measured = numericState(statesById, rating.powerSensorEntityId);
  const state = firstLiveState(statesById, rating.entityIds);
  let watts = 0;
  const stateName = state?.state ?? "missing";

  if (measured !== null) {
    watts = measured;
  } else if (!state || !stateIsLive(state)) {
    watts = 0;
  } else if (rating.kind === "climate") {
    watts = climateWatts(rating, state);
  } else if (state.state === "on") {
    watts = (rating.standbyWatts ?? 0) + rating.ratedWatts * brightnessFactor(state) * colorFactor(state);
  } else {
    watts = rating.standbyWatts ?? 0;
  }

  return {
    confidence: rating.confidence,
    entityId: state?.entity_id ?? null,
    id: rating.id,
    kwhTotal: persisted?.kwhTotal ?? 0,
    name: rating.name,
    notes: rating.notes,
    ratedWatts: rating.ratedWatts,
    source: rating.source,
    state: stateName,
    watts: round(watts, 2),
    zone: rating.zone,
  };
}

function addBucket(bucket: PowerBucket | undefined, kwh: number, costNzd: number): PowerBucket {
  return {
    costNzd: round((bucket?.costNzd ?? 0) + costNzd, 4),
    kwh: round((bucket?.kwh ?? 0) + kwh, 5),
  };
}

function currentTouPeriod(date: Date): TariffPeriod {
  const parts = localParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return "off_peak";
  }
  const minutes = parts.hour * 60 + parts.minute;
  const morningPeak = minutes >= 7 * 60 && minutes < 11 * 60;
  const eveningPeak = minutes >= 17 * 60 && minutes < 21 * 60;
  return morningPeak || eveningPeak ? "peak" : "off_peak";
}

function currentRate(date: Date) {
  const ratesConfig = powerConfig().rates;
  const { month } = localParts(date);
  const index = Math.max(0, Math.min(11, month - 1));
  const period = currentTouPeriod(date);
  return {
    cPerKwh: powershopStandardUserStandardAnytime[index],
    dailyCents: 313.03,
    displayName: "Powershop Auckland Central/South Standard User Standard Power - Anytime (assumed)",
    period,
    sourceUrl: ratesConfig.ratecardUrl || POWERSHOP_AUCKLAND_RATECARD,
    touCPerKwh: period === "peak" ? powershopStandardUserStandardPeak[index] : powershopStandardUserStandardOffPeak[index],
  };
}

function rateCentsForMonth(year: number, monthIndex: number) {
  return (year <= 2025 ? powershopStandardUserStandardAnytime2025 : powershopStandardUserStandardAnytime)[monthIndex];
}

function averageFridgeKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.aucklandMonthlyTempsC[monthIndex] ?? aucklandMonthlyTempsC[monthIndex];
  return 1.15 + Math.max(0, averageTemp - 12) * 0.035;
}

function averageWaterHeaterKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.aucklandMonthlyTempsC[monthIndex] ?? aucklandMonthlyTempsC[monthIndex];
  return 6.3 + Math.max(0, 17 - averageTemp) * 0.45;
}

function desktopActiveHoursPerDay() {
  const modeled = powerConfig().modeledBaseLoads;
  return modeled.desktopActiveEndHour - modeled.desktopActiveStartHour;
}

function desktopDailyKwh() {
  const modeled = powerConfig().modeledBaseLoads;
  const activeHours = desktopActiveHoursPerDay();
  return (modeled.desktopActiveWatts * activeHours + modeled.desktopStandbyWatts * (24 - activeHours)) / 1000;
}

function desktopActiveHoursElapsed(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  return Math.max(0, Math.min(hourOfDay, modeled.desktopActiveEndHour) - modeled.desktopActiveStartHour);
}

function desktopKwhElapsed(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  const activeHours = desktopActiveHoursElapsed(hourOfDay);
  return (modeled.desktopActiveWatts * activeHours + modeled.desktopStandbyWatts * Math.max(0, hourOfDay - activeHours)) / 1000;
}

function desktopCurrentWatts(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  return hourOfDay >= modeled.desktopActiveStartHour && hourOfDay < modeled.desktopActiveEndHour
    ? modeled.desktopActiveWatts
    : modeled.desktopStandbyWatts;
}

function novaDailyKwh() {
  return (powerConfig().modeledBaseLoads.novaAioAverageWatts * 24) / 1000;
}

function modeledDailyBaseKwh(year: number, monthIndex: number) {
  const fridgeKwh = averageFridgeKwhPerDay(monthIndex);
  const waterHeaterKwh = averageWaterHeaterKwhPerDay(monthIndex);
  const computerKwh = desktopDailyKwh();
  const novaKwh = novaDailyKwh();
  return {
    computerKwh,
    fridgeKwh,
    novaKwh,
    totalKwh: fridgeKwh + waterHeaterKwh + computerKwh + novaKwh,
    waterHeaterKwh,
    year,
  };
}

function modeledBaseCost(kwh: number, days: number, year: number, monthIndex: number) {
  return kwh * (rateCentsForMonth(year, monthIndex) / 100) + days * (313.03 / 100);
}

function modeledBasePeriod(year: number, monthIndex: number, elapsedDays: number, fullDays: number) {
  const daily = modeledDailyBaseKwh(year, monthIndex);
  const elapsedKwh = daily.totalKwh * elapsedDays;
  const fullKwh = daily.totalKwh * fullDays;
  return {
    elapsedCostNzd: modeledBaseCost(elapsedKwh, elapsedDays, year, monthIndex),
    elapsedKwh,
    fullCostNzd: modeledBaseCost(fullKwh, fullDays, year, monthIndex),
    fullKwh,
  };
}

function modeledBaseRange(startUtc: Date, days: number) {
  let remainingDays = Math.max(0, days);
  let cursor = new Date(startUtc.getTime());
  let costNzd = 0;
  let kwh = 0;

  while (remainingDays > 0.000001) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
    const daysUntilNextMonth = Math.max(0.000001, (nextMonth.getTime() - cursor.getTime()) / 86_400_000);
    const segmentDays = Math.min(remainingDays, daysUntilNextMonth);
    const daily = modeledDailyBaseKwh(year, monthIndex);
    const segmentKwh = daily.totalKwh * segmentDays;
    kwh += segmentKwh;
    costNzd += modeledBaseCost(segmentKwh, segmentDays, year, monthIndex);
    remainingDays -= segmentDays;
    cursor = new Date(cursor.getTime() + segmentDays * 86_400_000);
  }

  return { costNzd, kwh };
}

function modeledBaseBillingCycle(keys: ReturnType<typeof currentKeys>) {
  const elapsed = modeledBaseRange(keys.billingStartUtc, keys.billingElapsedDays);
  const full = modeledBaseRange(keys.billingStartUtc, keys.billingDays);
  return {
    elapsedCostNzd: elapsed.costNzd,
    elapsedKwh: elapsed.kwh,
    fullCostNzd: full.costNzd,
    fullKwh: full.kwh,
  };
}

function modeledBaseYear(keys: ReturnType<typeof currentKeys>) {
  let elapsedCostNzd = 0;
  let elapsedKwh = 0;
  let fullCostNzd = 0;
  let fullKwh = 0;
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const fullDays = daysInMonth(keys.year, monthIndex);
    const elapsedDays =
      monthIndex < keys.month - 1 ? fullDays : monthIndex === keys.month - 1 ? keys.day - 1 + keys.dayFraction : 0;
    const period = modeledBasePeriod(keys.year, monthIndex, elapsedDays, fullDays);
    elapsedCostNzd += period.elapsedCostNzd;
    elapsedKwh += period.elapsedKwh;
    fullCostNzd += period.fullCostNzd;
    fullKwh += period.fullKwh;
  }
  return { elapsedCostNzd, elapsedKwh, fullCostNzd, fullKwh };
}

function modeledCurrentBaseLoad(now: Date, rate: ReturnType<typeof currentRate>, keys: ReturnType<typeof currentKeys>): PowerBaseLoadSummary {
  const modeled = powerConfig().modeledBaseLoads;
  const parts = localParts(now);
  const hourOfDay = parts.hour + parts.minute / 60 + parts.second / 3600;
  const monthIndex = Math.max(0, Math.min(11, parts.month - 1));
  const daily = modeledDailyBaseKwh(parts.year, monthIndex);
  const fixedCostPerDayNzd = rate.dailyCents / 100;
  const usageCostPerDayNzd = daily.totalKwh * (rate.cPerKwh / 100);
  const fridgeElapsed = daily.fridgeKwh * keys.dayFraction;
  const waterHeaterElapsed = daily.waterHeaterKwh * keys.dayFraction;
  const computerElapsed = desktopKwhElapsed(hourOfDay);
  const novaElapsed = daily.novaKwh * keys.dayFraction;
  const elapsedKwh = fridgeElapsed + waterHeaterElapsed + computerElapsed + novaElapsed;
  const elapsedCostNzd = elapsedKwh * (rate.cPerKwh / 100) + fixedCostPerDayNzd * keys.dayFraction;
  const fridgeWatts = (daily.fridgeKwh * 1000) / 24;
  const waterHeaterWatts = (daily.waterHeaterKwh * 1000) / 24;
  const computerWatts = desktopCurrentWatts(hourOfDay);

  const devices: PowerModeledLoad[] = [
    {
      costPerDayNzd: round(daily.fridgeKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(fridgeWatts, 1),
      elapsedCostNzd: round(fridgeElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(fridgeElapsed, 3),
      id: "fridges",
      kwhPerDay: round(daily.fridgeKwh, 3),
      name: "Fridges",
      notes: "Continuous compressor model with Auckland seasonal temperature weighting.",
    },
    {
      costPerDayNzd: round(daily.waterHeaterKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(waterHeaterWatts, 1),
      elapsedCostNzd: round(waterHeaterElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(waterHeaterElapsed, 3),
      id: "water_heater",
      kwhPerDay: round(daily.waterHeaterKwh, 3),
      name: "Water heater",
      notes: "Always-on thermal model, higher in cooler Auckland months.",
    },
    {
      costPerDayNzd: round(daily.computerKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(computerWatts, 1),
      elapsedCostNzd: round(computerElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(computerElapsed, 3),
      id: "desktop_pc",
      kwhPerDay: round(daily.computerKwh, 3),
      name: "Desktop PC",
      notes: "800W PSU treated as capacity; model assumes daytime active use and overnight standby.",
    },
    {
      costPerDayNzd: round(daily.novaKwh * (rate.cPerKwh / 100), 2),
      currentWatts: modeled.novaAioAverageWatts,
      elapsedCostNzd: round(novaElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(novaElapsed, 3),
      id: "nova_aio",
      kwhPerDay: round(daily.novaKwh, 3),
      name: "Nova",
      notes: "Always-on ASUS Zen AiO class model, based on a 90W adapter with lower average draw.",
    },
  ];

  return {
    costPerDayNzd: round(usageCostPerDayNzd + fixedCostPerDayNzd, 2),
    currentWatts: round(fridgeWatts + waterHeaterWatts + computerWatts + modeled.novaAioAverageWatts, 1),
    devices,
    elapsedCostNzd: round(elapsedCostNzd, 2),
    elapsedKwh: round(elapsedKwh, 3),
    fixedCostPerDayNzd: round(fixedCostPerDayNzd, 2),
    kwhPerDay: round(daily.totalKwh, 3),
    usageCostPerDayNzd: round(usageCostPerDayNzd, 2),
  };
}

function sumBuckets(state: PowerState, from: string, to: string) {
  return Object.entries(state.daily).reduce(
    (sum, [key, bucket]) => {
      if (key >= from && key <= to) {
        sum.kwh += bucket.kwh;
        sum.costNzd += bucket.costNzd;
      }
      return sum;
    },
    { costNzd: 0, kwh: 0 },
  );
}

function projected(summary: { costNzd: number; kwh: number }, fraction: number): PowerPeriodSummary {
  const safeFraction = Math.max(0.04, Math.min(1, fraction));
  return {
    costNzd: round(summary.costNzd, 2),
    kwh: round(summary.kwh, 3),
    projectedCostNzd: round(summary.costNzd / safeFraction, 2),
    projectedKwh: round(summary.kwh / safeFraction, 3),
  };
}

function projectedWithBase(
  summary: { costNzd: number; kwh: number },
  fraction: number,
  base: { elapsedCostNzd: number; elapsedKwh: number; fullCostNzd: number; fullKwh: number },
): PowerPeriodSummary {
  const safeFraction = Math.max(0.04, Math.min(1, fraction));
  return {
    costNzd: round(summary.costNzd + base.elapsedCostNzd, 2),
    kwh: round(summary.kwh + base.elapsedKwh, 3),
    projectedCostNzd: round(summary.costNzd / safeFraction + base.fullCostNzd, 2),
    projectedKwh: round(summary.kwh / safeFraction + base.fullKwh, 3),
  };
}

function projectedYear(summary: { costNzd: number; kwh: number }, keys: ReturnType<typeof currentKeys>): PowerPeriodSummary {
  const weights = powerConfig().modeledBaseLoads.monthWeights;
  let elapsedWeight = 0;
  for (let i = 0; i < keys.month - 1; i += 1) {
    elapsedWeight += weights[i] ?? monthWeights[i];
  }
  elapsedWeight += (weights[keys.month - 1] ?? monthWeights[keys.month - 1]) * keys.monthFraction;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const factor = totalWeight / Math.max(0.15, elapsedWeight);

  return {
    costNzd: round(summary.costNzd, 2),
    kwh: round(summary.kwh, 3),
    projectedCostNzd: round(summary.costNzd * factor, 2),
    projectedKwh: round(summary.kwh * factor, 3),
  };
}

function hourlyGraph(state: PowerState, now: Date) {
  const cutoff = new Date(now.getTime() - 36 * 60 * 60_000);
  const cutoffKey = hourKeyFromParts(localParts(cutoff));
  return Object.entries(state.hourly)
    .filter(([key]) => key >= cutoffKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-36)
    .map(([key, bucket]) => ({
      costNzd: round(bucket.costNzd, 2),
      kwh: round(bucket.kwh, 3),
      label: key.slice(5).replace("T", " "),
    }));
}

function rateGraph(state: PowerState) {
  const baseline = [
    ...powershopStandardUserStandardAnytime2025.map((cPerKwh, index) => ({
      cPerKwh,
      label: `2025-${(index + 1).toString().padStart(2, "0")}`,
    })),
    ...powershopStandardUserStandardAnytime.map((cPerKwh, index) => ({
      cPerKwh,
      label: `2026-${(index + 1).toString().padStart(2, "0")}`,
    })),
  ];
  const history = state.rateHistory.slice(-730).map((entry) => ({
    cPerKwh: entry.cPerKwh,
    label: entry.label,
  }));
  const byLabel = new Map(baseline.map((point) => [point.label, point]));
  for (const point of history) {
    byLabel.set(point.label, point);
  }
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function backgroundEstimates(accountUsage: PowerAccountUsagePoint[]): PowerBackgroundEstimatePoint[] {
  return accountUsage.flatMap((point) => {
    const month = monthFromLabel(point.label);
    if (!month) {
      return [];
    }

    const days = point.days ?? daysInMonth(month.year, month.monthIndex);
    const dailyBase = modeledDailyBaseKwh(month.year, month.monthIndex);
    const fridgeKwh = round(dailyBase.fridgeKwh * days, 1);
    const waterHeaterKwh = round(dailyBase.waterHeaterKwh * days, 1);
    const computerKwh = round(dailyBase.computerKwh * days, 1);
    const novaKwh = round(dailyBase.novaKwh * days, 1);
    const knownKwh = fridgeKwh + waterHeaterKwh + computerKwh + novaKwh;

    return [
      {
        computerKwh,
        fridgeKwh,
        label: point.label,
        novaKwh,
        otherKwh: round(Math.max(0, point.kwh - knownKwh), 1),
        totalKwh: point.kwh,
        waterHeaterKwh,
      },
    ];
  });
}

function pruneState(state: PowerState, now: Date) {
  const dailyCutoff = dateKeyFromParts(localParts(new Date(now.getTime() - 800 * 86_400_000)));
  for (const key of Object.keys(state.daily)) {
    if (key < dailyCutoff) {
      delete state.daily[key];
    }
  }

  const hourlyCutoff = hourKeyFromParts(localParts(new Date(now.getTime() - 45 * 86_400_000)));
  for (const key of Object.keys(state.hourly)) {
    if (key < hourlyCutoff) {
      delete state.hourly[key];
    }
  }

  state.rateHistory = state.rateHistory.slice(-760);
}

async function fetchHash(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      hash: crypto.createHash("sha256").update(buffer).digest("hex"),
      ok: response.ok,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshPowerRatesIfDue(state: PowerState, now: Date, rate: ReturnType<typeof currentRate>) {
  const config = powerConfig();
  const last = state.lastRateCheck?.checkedAt ? new Date(state.lastRateCheck.checkedAt).getTime() : 0;
  const keys = currentKeys(now);
  const todayLabel = keys.dateKey;
  if (!state.rateHistory.some((entry) => entry.label === todayLabel)) {
    state.rateHistory.push({ at: now.toISOString(), cPerKwh: rate.cPerKwh, label: todayLabel });
  }

  if (Date.now() - last < config.timing.rateCheckIntervalMs) {
    return;
  }

  try {
    const [page, pdf] = await Promise.all([fetchHash(config.rates.pageUrl), fetchHash(config.rates.ratecardUrl)]);
    state.lastRateCheck = {
      checkedAt: now.toISOString(),
      ok: page.ok && pdf.ok,
      pageHash: page.hash,
      pdfHash: pdf.hash,
      sourceUrl: config.rates.ratecardUrl,
      warning: page.ok && pdf.ok ? undefined : "Powershop rate source returned a non-OK response.",
    };
  } catch (error) {
    state.lastRateCheck = {
      checkedAt: now.toISOString(),
      ok: false,
      sourceUrl: config.rates.ratecardUrl,
      warning: error instanceof Error ? error.message : "Rate check failed",
    };
  }
}

function buildDashboard(
  state: PowerState,
  readings: PowerDeviceReading[],
  accountUsage: PowerAccountUsagePoint[],
  now: Date,
): PowerDashboard {
  const keys = currentKeys(now);
  const rate = currentRate(now);
  const day = state.daily[keys.today] ?? { costNzd: 0, kwh: 0 };
  const week = sumBuckets(state, keys.weekStart, keys.today);
  const month = sumBuckets(state, keys.billingStart, keys.today);
  const ytd = sumBuckets(state, keys.yearStart, keys.today);
  const baseLoad = modeledCurrentBaseLoad(now, rate, keys);
  const monitoredWatts = readings.reduce((sum, reading) => sum + reading.watts, 0);
  const currentWatts = monitoredWatts + baseLoad.currentWatts;
  const totalKwh = Object.values(state.devices).reduce((sum, device) => sum + device.kwhTotal, 0);
  const totalCost = Object.values(state.daily).reduce((sum, bucket) => sum + bucket.costNzd, 0);
  const dayBase = {
    elapsedCostNzd: baseLoad.elapsedCostNzd,
    elapsedKwh: baseLoad.elapsedKwh,
    fullCostNzd: baseLoad.costPerDayNzd,
    fullKwh: baseLoad.kwhPerDay,
  };
  const weekBase = modeledBasePeriod(keys.year, keys.month - 1, keys.weekFraction * 7, 7);
  const monthBase = modeledBaseBillingCycle(keys);
  const yearBase = modeledBaseYear(keys);
  const connectedYearProjection = projectedYear(ytd, keys);

  return {
    baseLoad,
    billingCycle: {
      day: Math.min(keys.billingDays, Math.floor(keys.billingElapsedDays) + 1),
      days: keys.billingDays,
      endDate: keys.billingEnd,
      label: keys.billingLabel,
      startDate: keys.billingStart,
    },
    currentCostPerHourNzd: round((currentWatts / 1000) * (rate.cPerKwh / 100) + rate.dailyCents / 100 / 24, 3),
    currentRate: {
      cPerKwh: rate.cPerKwh,
      dailyCents: rate.dailyCents,
      displayName: rate.displayName,
      period: rate.period,
      sourceUrl: rate.sourceUrl,
    },
    currentWatts: round(currentWatts, 1),
    devices: readings.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name)),
    generatedAt: now.toISOString(),
    graph: hourlyGraph(state, now),
    accountUsageGraph: accountUsage,
    accountRateGraph: accountUsage
      .filter((point) => Number.isFinite(Number(point.avgUnitCents)))
      .map((point) => ({ cPerKwh: round(Number(point.avgUnitCents), 2), label: point.label })),
    backgroundEstimateGraph: backgroundEstimates(accountUsage),
    lastRateCheckAt: state.lastRateCheck?.checkedAt ?? null,
    lastSampleAt: state.lastSampleAt,
    rateGraph: rateGraph(state),
    ratesWarning: state.lastRateCheck?.warning,
    summaries: {
      day: projectedWithBase(day, keys.dayFraction, dayBase),
      week: projectedWithBase(week, keys.weekFraction, weekBase),
      month: projectedWithBase(month, keys.billingFraction, monthBase),
      yearToDate: {
        costNzd: round(ytd.costNzd + yearBase.elapsedCostNzd, 2),
        kwh: round(ytd.kwh + yearBase.elapsedKwh, 3),
        projectedCostNzd: round((connectedYearProjection.projectedCostNzd ?? 0) + yearBase.fullCostNzd, 2),
        projectedKwh: round((connectedYearProjection.projectedKwh ?? 0) + yearBase.fullKwh, 3),
      },
    },
    totals: {
      costNzd: round(totalCost, 2),
      kwh: round(totalKwh, 3),
    },
  };
}

async function publishMqtt(topic: string, payload: unknown, retain = true) {
  await callService("mqtt", "publish", {
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    qos: 0,
    retain,
    topic,
  });
}

function sensorDevice(rating?: PowerDeviceRating) {
  return {
    identifiers: [`nova_power_${rating?.id ?? "home"}`],
    manufacturer: rating?.manufacturer ?? "Nova",
    model: rating?.model ?? "Estimated power model",
    name: rating?.name ?? "Nova Grid",
  };
}

async function publishDiscovery(ratings: PowerDeviceRating[]) {
  const configs = ratings.flatMap((rating) => {
    const id = slug(rating.id);
    const stateTopic = `nova/power/${id}/state`;
    const device = sensorDevice(rating);
    return [
      {
        topic: `homeassistant/sensor/nova_power_${id}_estimated_power/config`,
        payload: {
          device,
          device_class: "power",
          json_attributes_topic: stateTopic,
          name: `${rating.name} estimated power`,
          object_id: `nova_power_${id}_estimated_power`,
          state_class: "measurement",
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_estimated_power`,
          unit_of_measurement: "W",
          value_template: "{{ value_json.watts }}",
        },
      },
      {
        topic: `homeassistant/sensor/nova_power_${id}_estimated_energy/config`,
        payload: {
          device,
          device_class: "energy",
          json_attributes_topic: stateTopic,
          name: `${rating.name} estimated energy`,
          object_id: `nova_power_${id}_estimated_energy`,
          state_class: "total_increasing",
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_estimated_energy`,
          unit_of_measurement: "kWh",
          value_template: "{{ value_json.kwh_total }}",
        },
      },
      {
        topic: `homeassistant/sensor/nova_power_${id}_rated_power/config`,
        payload: {
          device,
          entity_category: "diagnostic",
          json_attributes_topic: stateTopic,
          name: `${rating.name} rated power`,
          object_id: `nova_power_${id}_rated_power`,
          state_topic: stateTopic,
          unique_id: `nova_power_${id}_rated_power`,
          unit_of_measurement: "W",
          value_template: "{{ value_json.rated_watts }}",
        },
      },
    ];
  });

  configs.push({
    topic: "homeassistant/sensor/nova_power_home_estimated_power/config",
    payload: {
      device: sensorDevice(),
      device_class: "power",
      json_attributes_topic: "nova/power/home/state",
      name: "Nova Grid estimated power",
      object_id: "nova_power_home_estimated_power",
      state_class: "measurement",
      state_topic: "nova/power/home/state",
      unique_id: "nova_power_home_estimated_power",
      unit_of_measurement: "W",
      value_template: "{{ value_json.watts }}",
    },
  });

  await Promise.allSettled(configs.map((config) => publishMqtt(config.topic, config.payload)));
}

async function publishPowerState(summary: PowerDashboard, ratings: PowerDeviceRating[]) {
  const ratingById = new Map(ratings.map((rating) => [rating.id, rating]));
  await Promise.allSettled(
    summary.devices.map((device) => {
      const rating = ratingById.get(device.id);
      return publishMqtt(`nova/power/${slug(device.id)}/state`, {
        confidence: device.confidence,
        entity_id: device.entityId,
        kwh_total: round(device.kwhTotal, 4),
        rated_watts: device.ratedWatts,
        source: device.source,
        state: device.state,
        watts: device.watts,
        zone: device.zone,
        aliases: rating?.entityIds ?? [],
      });
    }),
  );
  await publishMqtt("nova/power/home/state", {
    cost_per_hour_nzd: summary.currentCostPerHourNzd,
    kwh_total: summary.totals.kwh,
    rate_c_per_kwh: summary.currentRate.cPerKwh,
    tariff_period: summary.currentRate.period,
    watts: summary.currentWatts,
  });
}

async function maybePublishToHa(summary: PowerDashboard, ratings: PowerDeviceRating[]) {
  const now = Date.now();
  const timing = powerConfig().timing;
  if (now - powerRuntime.discoveryPublishedAt > timing.discoveryIntervalMs) {
    await publishDiscovery(ratings);
    powerRuntime.discoveryPublishedAt = now;
  }
  if (now - powerRuntime.haPublishedAt > timing.haPublishIntervalMs) {
    await publishPowerState(summary, ratings);
    powerRuntime.haPublishedAt = now;
  }
}

async function samplePowerUnlocked(): Promise<PowerDashboard> {
  const now = new Date();
  const [persisted, ratings, accountUsage, states] = await Promise.all([
    readJson<PowerState>(POWER_STATE_PATH, blankState()),
    readRatings(),
    readAccountUsage(),
    haRest<HaState[]>("/api/states"),
  ]);
  const state = { ...blankState(), ...persisted };
  const statesById = new Map(states.map((haState) => [haState.entity_id, haState]));
  const readings = ratings.map((rating) => estimateDevice(rating, statesById, state.devices[rating.id]));
  const keys = currentKeys(now);
  const rate = currentRate(now);

  const lastSampleMs = state.lastSampleAt ? new Date(state.lastSampleAt).getTime() : NaN;
  const elapsedHours = Number.isFinite(lastSampleMs) ? (now.getTime() - lastSampleMs) / 3_600_000 : 0;
  if (elapsedHours > 0 && elapsedHours <= powerConfig().timing.maxIntegrationHours) {
    for (const reading of readings) {
      const previous = state.devices[reading.id];
      const integratedWatts = previous?.lastWatts ?? reading.watts;
      const kwh = (integratedWatts * elapsedHours) / 1000;
      const costNzd = kwh * (rate.cPerKwh / 100);
      const nextTotal = (previous?.kwhTotal ?? 0) + kwh;
      state.devices[reading.id] = {
        kwhTotal: round(nextTotal, 5),
        lastEntityId: reading.entityId,
        lastState: reading.state,
        lastWatts: reading.watts,
        updatedAt: now.toISOString(),
      };
      reading.kwhTotal = round(nextTotal, 5);
      state.daily[keys.dateKey] = addBucket(state.daily[keys.dateKey], kwh, costNzd);
      state.hourly[keys.hourKey] = addBucket(state.hourly[keys.hourKey], kwh, costNzd);
    }
  } else {
    for (const reading of readings) {
      const previous = state.devices[reading.id];
      state.devices[reading.id] = {
        kwhTotal: previous?.kwhTotal ?? 0,
        lastEntityId: reading.entityId,
        lastState: reading.state,
        lastWatts: reading.watts,
        updatedAt: now.toISOString(),
      };
      reading.kwhTotal = previous?.kwhTotal ?? 0;
    }
  }

  state.lastSampleAt = now.toISOString();
  await refreshPowerRatesIfDue(state, now, rate);
  pruneState(state, now);
  await writeJsonAtomic(POWER_STATE_PATH, state);
  const summary = buildDashboard(state, readings, accountUsage, now);
  void maybePublishToHa(summary, ratings).catch((error) => {
    console.warn("[nova-dashboard] failed to publish power sensors", error);
  });
  return summary;
}

export async function samplePowerNow(): Promise<PowerDashboard> {
  if (!powerRuntime.samplePromise) {
    powerRuntime.samplePromise = samplePowerUnlocked().finally(() => {
      powerRuntime.samplePromise = null;
    });
  }
  return powerRuntime.samplePromise;
}

export function ensurePowerMonitorStarted() {
  if (powerRuntime.monitorStarted) {
    return;
  }
  powerRuntime.monitorStarted = true;
  void samplePowerNow().catch((error) => {
    console.warn("[nova-dashboard] initial power sample failed", error);
  });
  powerRuntime.timer = setInterval(() => {
    void samplePowerNow().catch((error) => {
      console.warn("[nova-dashboard] power sample failed", error);
    });
  }, powerConfig().timing.sampleIntervalMs || SAMPLE_INTERVAL_MS);
}
