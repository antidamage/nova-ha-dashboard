import path from "path";
import { readdir, readFile, stat } from "fs/promises";

const POWERSHOP_DATA_DIR =
  process.env.POWERSHOP_DATA_DIR ?? path.join(process.cwd(), "data", "power", "powershop");

export type PowershopDailyUsageRecord = {
  capturedAt: string;
  rawEvidencePath?: string;
  schemaVersion?: number;
  source: "powershop";
  status: "ok" | "partial" | "error" | "requires_mfa" | "requires_interaction" | "skipped_not_overnight" | "login_ok";
  targetDate: string;
  intervals?: Array<{
    costNzd: number;
    endAt: string;
    kwh: number;
    standingCostNzd: number;
    startAt: string;
    usageCostNzd: number;
  }>;
  values?: {
    costNzd: number | null;
    kwh: number | null;
    meterReading?: number | null;
    unitPriceCents?: number | null;
  };
  warning?: string;
  warnings?: string[];
};

export type PowershopAccountMetadata = {
  billing: {
    currentPeriodEndDate: string;
    currentPeriodStartDate: string;
    isFixed: boolean;
    nextBillingDate: string | null;
    periodStartDay: number | null;
  };
  capturedAt: string;
  schemaVersion: number;
  source: "powershop";
};

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeRecord(value: unknown): PowershopDailyUsageRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<PowershopDailyUsageRecord>;
  if (record.source !== "powershop" || typeof record.targetDate !== "string" || !isDateKey(record.targetDate)) {
    return null;
  }
  if (typeof record.capturedAt !== "string" || typeof record.status !== "string") {
    return null;
  }
  return record as PowershopDailyUsageRecord;
}

async function readUsageFile(filePath: string) {
  try {
    return normalizeRecord(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

type DailyUsageCacheEntry = {
  directoryMtimeMs: number;
  records: PowershopDailyUsageRecord[];
};

const dailyUsageCache = new Map<string, DailyUsageCacheEntry>();

export async function readPowershopDailyUsage(date: string, dataDir = POWERSHOP_DATA_DIR) {
  if (!isDateKey(date)) {
    return null;
  }
  return readUsageFile(path.join(dataDir, "daily", `${date}.json`));
}

export async function readLatestPowershopUsage(dataDir = POWERSHOP_DATA_DIR) {
  return readUsageFile(path.join(dataDir, "latest.json"));
}

export async function readPowershopAccountMetadata(dataDir = POWERSHOP_DATA_DIR) {
  try {
    const value = JSON.parse(await readFile(path.join(dataDir, "account.json"), "utf8")) as Partial<PowershopAccountMetadata>;
    const billing = value.billing;
    if (
      value.source !== "powershop" ||
      typeof value.capturedAt !== "string" ||
      !billing ||
      !isDateKey(billing.currentPeriodStartDate ?? "") ||
      !isDateKey(billing.currentPeriodEndDate ?? "")
    ) {
      return null;
    }
    return value as PowershopAccountMetadata;
  } catch {
    return null;
  }
}

export async function readAllPowershopUsage(dataDir = POWERSHOP_DATA_DIR) {
  const dailyDir = path.join(dataDir, "daily");
  let directoryMtimeMs: number;
  try {
    directoryMtimeMs = (await stat(dailyDir)).mtimeMs;
  } catch {
    return [];
  }

  const cached = dailyUsageCache.get(dailyDir);
  if (cached?.directoryMtimeMs === directoryMtimeMs) {
    return cached.records.slice();
  }

  let files: string[];
  try {
    files = await readdir(dailyDir);
  } catch {
    return [];
  }

  const records = await Promise.all(
    files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .map((file) => file.slice(0, -5))
      .sort()
      .map((date) => readPowershopDailyUsage(date, dataDir)),
  );
  const validRecords = records.filter((record): record is PowershopDailyUsageRecord => Boolean(record));
  dailyUsageCache.set(dailyDir, { directoryMtimeMs, records: validRecords });
  return validRecords.slice();
}

export async function readPowershopUsageRange(startDate: string, endDate: string, dataDir = POWERSHOP_DATA_DIR) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return [];
  }
  return (await readAllPowershopUsage(dataDir)).filter(
    (record) => record.targetDate >= startDate && record.targetDate <= endDate,
  );
}
