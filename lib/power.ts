import crypto from "crypto";
import path from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { callService, haRest } from "./ha";
import type { HaState } from "./types";
import { readDashboardConfigSync } from "./dashboard-config";
import type { PowerAccountUsagePoint, PowerDeviceRating, PowerTariff } from "./config-schema";

// Timings, billing days, the timezone and the tariff all come from config.
// There are deliberately no constants shadowing them here: a `config ?? LOCAL`
// pair keeps one household's values compiled into the product, which is how
// they survived being "moved to config" the first time.
const POWER_DATA_DIR = process.env.NOVA_DASHBOARD_POWER_DATA ?? path.join(process.cwd(), "data", "power");
const POWER_STATE_PATH = path.join(POWER_DATA_DIR, "state.json");
const POWER_ACCOUNT_USAGE_PATH = path.join(POWER_DATA_DIR, "account-usage.json");

function powerConfig() {
  return readDashboardConfigSync().power;
}

type TariffPeriod = "anytime" | "peak" | "off_peak";

// The shape lives with the config schema that validates it, so there is exactly
// one definition of a rating rather than a type here and a schema there.
export type { PowerDeviceRating };

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

// Defined with the schema that validates it, like PowerDeviceRating above.
export type { PowerAccountUsagePoint };

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

/**
 * Billing periods and hourly buckets are local-time concepts, so the zone comes
 * from `power.timeZone` rather than a constant naming one city. Built lazily and
 * cached per zone: a DateTimeFormat is not cheap, and config can change under a
 * running process.
 */
let localFormatterCache: { timeZone: string; formatter: Intl.DateTimeFormat } | null = null;

function localFormatter() {
  const timeZone = powerConfig().timeZone;
  if (localFormatterCache?.timeZone !== timeZone) {
    localFormatterCache = {
      timeZone,
      formatter: new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "2-digit",
        second: "2-digit",
        timeZone,
        weekday: "short",
        year: "numeric",
      }),
    };
  }
  return localFormatterCache.formatter;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];



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
  const parts = Object.fromEntries(localFormatter().formatToParts(date).map((part) => [part.type, part.value]));
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
  const billingEndDay = billingConfig.endDay;
  const billingStartDay = billingConfig.startDay;
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

// Device ratings come from `power.deviceRatings` in dashboard config. They used
// to be a table in this file mirrored to data/power/device-ratings.json, which
// meant a device could be listed in one place and not the other: the on-disk
// copy silently outranked the source, and removing a device from only the table
// left it resurrected. One config document, one answer.
function readRatings(): PowerDeviceRating[] {
  return powerConfig().deviceRatings;
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
    // Billing history is personal, so nothing is seeded here. It arrives from
    // `power.accountHistory` in config (the household package), and an
    // installation that has imported none simply has an empty history graph.
    const configured = powerConfig().accountHistory;
    if (configured.length) {
      await writeJsonAtomic(POWER_ACCOUNT_USAGE_PATH, configured);
    }
    return configured;
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

/**
 * The configured electricity plan, or null when this installation has not been
 * told what it pays. Absent rates are a supported state — see the power module,
 * which reports itself inactive — so every caller must handle null rather than
 * falling back to whatever one household happened to be on.
 */
function tariff(): PowerTariff | null {
  return powerConfig().rates.tariff ?? null;
}

function currentRate(date: Date) {
  const ratesConfig = powerConfig().rates;
  const plan = tariff();
  const { month } = localParts(date);
  const index = Math.max(0, Math.min(11, month - 1));
  const period = currentTouPeriod(date);
  return {
    cPerKwh: plan?.anytimeCPerKwh[index] ?? 0,
    dailyCents: plan?.dailyCents ?? 0,
    displayName: plan?.planName ?? "No electricity plan configured",
    period,
    sourceUrl: ratesConfig.ratecardUrl ?? ratesConfig.pageUrl ?? "",
    touCPerKwh: (period === "peak" ? plan?.peakCPerKwh[index] : plan?.offPeakCPerKwh[index]) ?? 0,
  };
}

function rateCentsForMonth(year: number, monthIndex: number) {
  const plan = tariff();
  if (!plan) return 0;
  // Historical series are ordered oldest first; the earliest one that still
  // covers this year wins, so a graph of past months uses the rate that was
  // actually in force rather than today's.
  const historical = [...plan.historicalAnytimeCPerKwh]
    .sort((a, b) => a.throughYear - b.throughYear)
    .find((series) => year <= series.throughYear);
  return (historical?.cPerKwh ?? plan.anytimeCPerKwh)[monthIndex];
}

function averageFridgeKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.monthlyOutdoorTempsC[monthIndex];
  return 1.15 + Math.max(0, averageTemp - 12) * 0.035;
}

function averageWaterHeaterKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.monthlyOutdoorTempsC[monthIndex];
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
    elapsedWeight += weights[i];
  }
  elapsedWeight += weights[keys.month - 1] * keys.monthFraction;
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
  const plan = tariff();
  // Each superseded series is plotted against the year it ran out, and the
  // current one against this year. The years used to be written into the code,
  // which meant the graph silently stopped extending after 2026.
  const series = plan
    ? [
        ...plan.historicalAnytimeCPerKwh.map((entry) => ({ year: entry.throughYear, rates: entry.cPerKwh })),
        { year: localParts(new Date()).year, rates: plan.anytimeCPerKwh },
      ]
    : [];
  const baseline = series.flatMap(({ year, rates }) =>
    rates.map((cPerKwh, index) => ({
      cPerKwh,
      label: `${year}-${(index + 1).toString().padStart(2, "0")}`,
    })),
  );
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

  // Nothing to watch when no retailer has been configured.
  const pageUrl = config.rates.pageUrl;
  const ratecardUrl = config.rates.ratecardUrl;
  if (!pageUrl && !ratecardUrl) {
    return;
  }

  try {
    const [page, pdf] = await Promise.all([
      pageUrl ? fetchHash(pageUrl) : Promise.resolve({ ok: true, hash: undefined }),
      ratecardUrl ? fetchHash(ratecardUrl) : Promise.resolve({ ok: true, hash: undefined }),
    ]);
    state.lastRateCheck = {
      checkedAt: now.toISOString(),
      ok: page.ok && pdf.ok,
      pageHash: page.hash,
      pdfHash: pdf.hash,
      sourceUrl: ratecardUrl ?? pageUrl ?? "",
      warning: page.ok && pdf.ok ? undefined : "The configured rate source returned a non-OK response.",
    };
  } catch (error) {
    state.lastRateCheck = {
      checkedAt: now.toISOString(),
      ok: false,
      sourceUrl: ratecardUrl ?? pageUrl ?? "",
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
  }, powerConfig().timing.sampleIntervalMs);
}
