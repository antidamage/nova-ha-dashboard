import type { PowerAccountUsagePoint } from "./config-schema";
import type { PowershopDailyUsageRecord } from "./powershop-usage";

type BillingConfig = {
  endDay: number;
  startDay: number;
};

export type PowershopBillingUsage = {
  complete: boolean;
  point: PowerAccountUsagePoint;
};

const DAY_MS = 86_400_000;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

function billingCycle(targetDate: string, billing: BillingConfig) {
  const [year, month, day] = targetDate.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + (day > billing.endDay ? 1 : 0), billing.endDay));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, billing.startDay));
  return {
    endDate: dateKey(end),
    expectedDays: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
    label: `${monthNames[end.getUTCMonth()]} ${end.getUTCFullYear()}`,
    startDate: dateKey(start),
  };
}

function labelOrder(label: string) {
  const [monthName, yearText] = label.split(/\s+/);
  const monthIndex = monthNames.indexOf(monthName);
  const year = Number(yearText);
  return monthIndex >= 0 && Number.isFinite(year) ? year * 12 + monthIndex : Number.POSITIVE_INFINITY;
}

/**
 * Convert valid daily retailer readings into the same billing-cycle points as
 * the account-history graph. Partial/error records are deliberately ignored:
 * a missing value must not silently lower a cycle's measured consumption.
 */
export function aggregatePowershopBillingUsage(
  records: PowershopDailyUsageRecord[],
  billing: BillingConfig,
): PowershopBillingUsage[] {
  const byDate = new Map(
    records
      .filter((record) => {
        const kwh = record.values?.kwh;
        const costNzd = record.values?.costNzd;
        return (
          record.status === "ok" &&
          typeof kwh === "number" &&
          Number.isFinite(kwh) &&
          kwh >= 0 &&
          typeof costNzd === "number" &&
          Number.isFinite(costNzd) &&
          costNzd >= 0
        );
      })
      .map((record) => [record.targetDate, record]),
  );
  const cycles = new Map<
    string,
    { costNzd: number; dates: Set<string>; endDate: string; expectedDays: number; kwh: number; startDate: string }
  >();

  for (const record of Array.from(byDate.values()).sort((a, b) => a.targetDate.localeCompare(b.targetDate))) {
    const cycle = billingCycle(record.targetDate, billing);
    const bucket = cycles.get(cycle.label) ?? {
      costNzd: 0,
      dates: new Set<string>(),
      endDate: cycle.endDate,
      expectedDays: cycle.expectedDays,
      kwh: 0,
      startDate: cycle.startDate,
    };
    bucket.costNzd += Number(record.values?.costNzd);
    bucket.kwh += Number(record.values?.kwh);
    bucket.dates.add(record.targetDate);
    cycles.set(cycle.label, bucket);
  }

  return Array.from(cycles.entries())
    .map(([label, bucket]) => {
      const days = bucket.dates.size;
      const complete =
        days === bucket.expectedDays && bucket.dates.has(bucket.startDate) && bucket.dates.has(bucket.endDate);
      const kwh = round(bucket.kwh, 1);
      const costNzd = round(bucket.costNzd, 2);
      return {
        complete,
        point: {
          avgUnitCents: kwh > 0 ? round((costNzd / kwh) * 100, 2) : 0,
          costNzd,
          costPerDayNzd: round(costNzd / days, 2),
          days,
          kwh,
          kwhPerDay: round(kwh / days, 1),
          label,
          source: complete ? "Powershop daily scrape" : "Powershop daily scrape (partial billing cycle)",
        },
      };
    })
    .sort((a, b) => labelOrder(a.point.label) - labelOrder(b.point.label));
}

/**
 * Overlay full scraped cycles on legacy account-table rows, while retaining a
 * complete legacy bill when the scrape only covers part of that same cycle.
 * A new in-progress cycle is still appended so the dashboard advances daily.
 */
export function mergePowershopAccountUsage(
  accountHistory: PowerAccountUsagePoint[],
  records: PowershopDailyUsageRecord[],
  billing: BillingConfig,
) {
  const merged = new Map(accountHistory.map((point) => [point.label, point]));
  for (const usage of aggregatePowershopBillingUsage(records, billing)) {
    if (usage.complete || !merged.has(usage.point.label)) {
      merged.set(usage.point.label, usage.point);
    }
  }
  return Array.from(merged.values()).sort((a, b) => labelOrder(a.label) - labelOrder(b.label));
}
