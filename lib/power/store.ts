// The power package's only owner of global, module-level and on-disk state:
// data paths, the globalThis runtime, the write queue, JSON persistence and the
// wash-curve cache. Nothing else in lib/power/ touches globalThis or fs.
import path from "path";
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { primaryWashingConfig } from "../wash-config";
import { readDashboardConfigSync } from "../dashboard-config";
import type { PowerAccountUsagePoint } from "../config-schema";
import { downsampleTrace, type WashingMachineState } from "../washing-machine";
import { mergePowershopAccountUsage } from "../powershop-account-usage";
import type { PowershopAccountMetadata, PowershopDailyUsageRecord } from "../powershop-usage";
import { blankFloatingMeterState } from "./floating-meter";
import { round } from "./numbers";
import type { OpenWashTrace, PowerDashboard, PowerState, WashTraceFile } from "./types";

// Timings, billing days, the timezone and the tariff all come from config.
// There are deliberately no constants shadowing them here: a `config ?? LOCAL`
// pair keeps one household's values compiled into the product, which is how
// they survived being "moved to config" the first time.
const POWER_DATA_DIR = process.env.NOVA_DASHBOARD_POWER_DATA ?? path.join(process.cwd(), "data", "power");
export const POWER_STATE_PATH = path.join(POWER_DATA_DIR, "state.json");
const POWER_ACCOUNT_USAGE_PATH = path.join(POWER_DATA_DIR, "account-usage.json");
export const WASHING_MACHINE_PATH = path.join(POWER_DATA_DIR, "washing-machine.json");
export const WASH_TRACE_DIR = path.join(POWER_DATA_DIR, "washing-machine-traces");
const WASH_OPEN_TRACE_PATH = path.join(WASH_TRACE_DIR, "open.json");

export function powerConfig() {
  const config = readDashboardConfigSync();
  return { ...config.power, washingMachine: primaryWashingConfig(config) };
}

/**
 * Billing periods and hourly buckets are local-time concepts, so the zone comes
 * from `power.timeZone` rather than a constant naming one city. Built lazily and
 * cached per zone: a DateTimeFormat is not cheap, and config can change under a
 * running process.
 */
let localFormatterCache: { timeZone: string; formatter: Intl.DateTimeFormat } | null = null;

export function localFormatter() {
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

const globalPower = globalThis as typeof globalThis & {
  __novaPower?: {
    discoveryPublishedAt: number;
    haPublishedAt: number;
    monitorStarted: boolean;
    samplePromise: Promise<PowerDashboard> | null;
    timer: ReturnType<typeof setInterval> | null;
    meterPromise?: Promise<void> | null;
    writeQueue?: Promise<unknown>;
    washReconcileSignature?: string;
    washReconciledAt?: number;
    pollInFlight?: boolean;
    pollLogged?: { failure: boolean; success: boolean };
    meterTimer?: ReturnType<typeof setInterval> | null;
    pollTimer?: ReturnType<typeof setInterval> | null;
  };
};

export const powerRuntime =
  globalPower.__novaPower ??
  (globalPower.__novaPower = {
    discoveryPublishedAt: 0,
    haPublishedAt: 0,
    monitorStarted: false,
    samplePromise: null,
    timer: null,
  });

export function blankState(): PowerState {
  return {
    daily: {},
    devices: {},
    floatingMeter: blankFloatingMeterState(),
    hourly: {},
    lastSampleAt: null,
    rateHistory: [],
    version: 1,
  };
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function readAccountUsage(
  dailyUsage: PowershopDailyUsageRecord[],
  accountMetadata: PowershopAccountMetadata | null,
) {
  let accountHistory: PowerAccountUsagePoint[];
  try {
    const usage = JSON.parse(await readFile(POWER_ACCOUNT_USAGE_PATH, "utf8")) as PowerAccountUsagePoint[];
    accountHistory = usage
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
    accountHistory = configured;
  }

  const config = powerConfig();
  const billing = accountMetadata?.billing.periodStartDay
    ? {
        endDay: Number(accountMetadata.billing.currentPeriodEndDate.slice(8, 10)),
        startDay: accountMetadata.billing.periodStartDay,
      }
    : config.billing;
  return mergePowershopAccountUsage(accountHistory, dailyUsage, billing);
}

export const washCurves = new Map<string, number[]>();
export let runningWashCurve: number[] | undefined;

/**
 * Append this tick's reading to the open wash's trace, and file the trace for
 * any wash that closed on this tick. Traces are recorded for every wash so a
 * later tap still has a curve.
 */
export async function recordWashTrace(
  knownCycleIds: Set<string>,
  washing: WashingMachineState,
  watts: number | null,
  now: Date,
) {
  const open = await readJson<OpenWashTrace>(WASH_OPEN_TRACE_PATH, { anchor: null, points: [] });
  const closed = washing.cycles.filter((cycle) => !knownCycleIds.has(cycle.id));
  for (const cycle of closed) {
    const start = Date.parse(cycle.startedAt) / 1000;
    const end = Date.parse(cycle.endedAt) / 1000;
    const points = open.anchor === cycle.startedAt
      ? open.points.filter(([at]) => at <= end).map(([at, value]): [number, number] => [Math.round(at - start), value])
      : [];
    const file: WashTraceFile = {
      ...(cycle.attribution ? { attribution: cycle.attribution } : {}),
      cycleId: cycle.id, endedAt: cycle.endedAt, kwh: cycle.kwh, person: cycle.person, points, startedAt: cycle.startedAt,
    };
    await writeJsonAtomic(path.join(WASH_TRACE_DIR, `${cycle.id}.json`), file);
    washCurves.set(cycle.id, downsampleTrace(points));
  }
  if (closed.length > 0) {
    // Traces live and die with their cycles (400 days).
    const keep = new Set(washing.cycles.map((cycle) => `${cycle.id}.json`));
    for (const name of await readdir(WASH_TRACE_DIR).catch(() => [] as string[])) {
      if (name.endsWith(".json") && name !== "open.json" && !keep.has(name)) {
        await unlink(path.join(WASH_TRACE_DIR, name)).catch(() => undefined);
      }
    }
  }

  const anchor = washing.open?.startedAt ?? washing.open?.aboveSince ?? null;
  if (!anchor) {
    runningWashCurve = undefined;
    if (open.anchor || open.points.length > 0) await writeJsonAtomic(WASH_OPEN_TRACE_PATH, { anchor: null, points: [] });
    return;
  }
  const points = open.anchor === anchor ? open.points : [];
  if (watts !== null) points.push([Math.round(now.getTime() / 1000), Math.round(watts * 10) / 10]);
  await writeJsonAtomic(WASH_OPEN_TRACE_PATH, { anchor, points });
  runningWashCurve = downsampleTrace(points);
}

/** Load curves for the washes the 12-hour graph can show; the rest stay on disk. */
export async function loadRecentWashCurves(washing: WashingMachineState, now: Date) {
  const since = now.getTime() - 12 * 3_600_000;
  for (const cycle of washing.cycles) {
    if (washCurves.has(cycle.id) || Date.parse(cycle.endedAt) < since) continue;
    const trace = await readJson<WashTraceFile | null>(path.join(WASH_TRACE_DIR, `${cycle.id}.json`), null);
    washCurves.set(cycle.id, downsampleTrace(trace?.points ?? []));
  }
}

export async function backupFile(filePath: string, stamp: string) {
  await copyFile(filePath, `${filePath}.bak-${stamp}`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export function backupStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

// On the global runtime so a hot reload shares one queue with the old module's timers.
export function serializePower<T>(work: () => Promise<T>): Promise<T> {
  const result = (powerRuntime.writeQueue ?? Promise.resolve()).then(work);
  powerRuntime.writeQueue = result.catch(() => undefined);
  return result;
}
