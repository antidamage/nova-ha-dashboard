import { describe, expect, it } from "vitest";
import type { PowershopDailyUsageRecord } from "./powershop-usage";
import { aggregatePowershopBillingUsage, mergePowershopAccountUsage } from "./powershop-account-usage";

const billing = { startDay: 19, endDay: 18 };

function daily(targetDate: string, kwh = 10, costNzd = 3): PowershopDailyUsageRecord {
  return {
    capturedAt: `${targetDate}T06:00:00Z`,
    source: "powershop",
    status: "ok",
    targetDate,
    values: { costNzd, kwh },
  };
}

function dateKeys(start: string, end: string) {
  const keys: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

describe("aggregatePowershopBillingUsage", () => {
  it("groups daily readings into billing months ending on the configured day", () => {
    const result = aggregatePowershopBillingUsage(
      [...dateKeys("2026-04-19", "2026-05-18"), "2026-05-19"].map((date) => daily(date)),
      billing,
    );

    expect(result).toEqual([
      {
        complete: true,
        point: {
          avgUnitCents: 30,
          costNzd: 90,
          costPerDayNzd: 3,
          days: 30,
          kwh: 300,
          kwhPerDay: 10,
          label: "May 2026",
          source: "Powershop daily scrape",
        },
      },
      {
        complete: false,
        point: {
          avgUnitCents: 30,
          costNzd: 3,
          costPerDayNzd: 3,
          days: 1,
          kwh: 10,
          kwhPerDay: 10,
          label: "Jun 2026",
          source: "Powershop daily scrape (partial billing cycle)",
        },
      },
    ]);
  });

  it("ignores partial and invalid readings instead of lowering a cycle", () => {
    const partial = { ...daily("2026-05-01"), status: "partial" as const };
    const missingCost = daily("2026-05-02");
    missingCost.values = { costNzd: null, kwh: 10 };

    expect(aggregatePowershopBillingUsage([partial, missingCost, daily("2026-05-03")], billing)[0]?.point.days).toBe(1);
  });
});

describe("mergePowershopAccountUsage", () => {
  it("keeps a complete legacy bill over an incomplete overlapping scrape", () => {
    const legacy = [{ label: "Apr 2026", days: 28, kwh: 708, source: "Powershop account table" }];
    const merged = mergePowershopAccountUsage(
      legacy,
      dateKeys("2026-04-13", "2026-04-18").map((date) => daily(date)),
      billing,
    );

    expect(merged).toEqual(legacy);
  });

  it("replaces an overlapping legacy row once the scraped cycle is complete and appends the current cycle", () => {
    const legacy = [{ label: "May 2026", days: 30, kwh: 999, source: "Powershop account table" }];
    const records = [...dateKeys("2026-04-19", "2026-05-18"), "2026-05-19"].map((date) => daily(date));
    const merged = mergePowershopAccountUsage(legacy, records, billing);

    expect(merged.map((point) => [point.label, point.kwh, point.days])).toEqual([
      ["May 2026", 300, 30],
      ["Jun 2026", 10, 1],
    ]);
  });
});
