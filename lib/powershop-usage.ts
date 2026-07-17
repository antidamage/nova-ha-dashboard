import path from "path";
import { readdir, readFile } from "fs/promises";

const POWERSHOP_DATA_DIR =
  process.env.POWERSHOP_DATA_DIR ?? path.join(process.cwd(), "data", "power", "powershop");

export type PowershopDailyUsageRecord = {
  capturedAt: string;
  rawEvidencePath?: string;
  schemaVersion?: number;
  source: "powershop";
  status: "ok" | "partial" | "error" | "requires_mfa" | "requires_interaction" | "skipped_not_overnight" | "login_ok";
  targetDate: string;
  values?: {
    costNzd: number | null;
    kwh: number | null;
    meterReading?: number | null;
    unitPriceCents?: number | null;
  };
  warning?: string;
  warnings?: string[];
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

export async function readPowershopDailyUsage(date: string, dataDir = POWERSHOP_DATA_DIR) {
  if (!isDateKey(date)) {
    return null;
  }
  return readUsageFile(path.join(dataDir, "daily", `${date}.json`));
}

export async function readLatestPowershopUsage(dataDir = POWERSHOP_DATA_DIR) {
  return readUsageFile(path.join(dataDir, "latest.json"));
}

export async function readPowershopUsageRange(startDate: string, endDate: string, dataDir = POWERSHOP_DATA_DIR) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return [];
  }
  let files: string[] = [];
  try {
    files = await readdir(path.join(dataDir, "daily"));
  } catch {
    return [];
  }
  const records = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter((date) => date >= startDate && date <= endDate)
      .sort()
      .map((date) => readPowershopDailyUsage(date, dataDir)),
  );
  return records.filter((record): record is PowershopDailyUsageRecord => Boolean(record));
}
