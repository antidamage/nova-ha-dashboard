import { describe, expect, it } from "vitest";
import { calibratePowershopEstimates, POWERSHOP_ESTIMATE_HALF_LIFE_DAYS } from "./power-estimation";
import type { PowershopDailyUsageRecord } from "./powershop-usage";

function dateBefore(today: string, days: number) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function dailyRecord(today: string, ageDays: number, kwh: number): PowershopDailyUsageRecord {
  const targetDate = dateBefore(today, ageDays);
  const hourlyKwh = Array.from({ length: 24 }, (_, hour) => (hour === 18 ? kwh * 0.12 : (kwh * 0.88) / 23));
  return {
    capturedAt: `${targetDate}T18:00:00Z`,
    intervals: hourlyKwh.map((value, hour) => ({
      costNzd: value * 0.3 + 0.1,
      endAt: `${targetDate}T${String(hour + 1).padStart(2, "0")}:00:00+12:00`,
      kwh: value,
      standingCostNzd: 0.1,
      startAt: `${targetDate}T${String(hour).padStart(2, "0")}:00:00+12:00`,
      usageCostNzd: value * 0.3,
    })),
    schemaVersion: 2,
    source: "powershop",
    status: "ok",
    targetDate,
    values: { costNzd: kwh * 0.3 + 2.4, kwh },
  };
}

function options(today: string) {
  return {
    billingEndDate: today,
    billingStartDate: dateBefore(today, 29),
    currentUsageRateCents: 30,
    fallbackCurrentCostPerHourNzd: 0.2,
    fallbackCurrentWatts: 500,
    fallbackDailyCostNzd: 8,
    fallbackDailyKwh: 20,
    localElapsedCostNzd: 2,
    localElapsedKwh: 5,
    nowHour: 18.5,
    today,
    weekStartDate: dateBefore(today, 5),
  };
}

describe("calibratePowershopEstimates", () => {
  it("weights recent days more strongly and uses the learned hourly load shape", () => {
    const today = "2026-08-15";
    const records = Array.from({ length: 70 }, (_, index) =>
      dailyRecord(today, index + 1, index < 28 ? 10 : 40),
    );

    const result = calibratePowershopEstimates(records, options(today));

    expect(result.calibration).toMatchObject({
      confidence: "high",
      halfLifeDays: POWERSHOP_ESTIMATE_HALF_LIFE_DAYS,
      historyDays: 70,
      intervalDays: 70,
      lastActualDate: "2026-08-14",
      source: "powershop_hourly",
    });
    expect(result.day.projectedKwh).toBeLessThan(25);
    expect(result.day.projectedKwh).toBeGreaterThan(10);
    expect(result.currentWatts).toBeGreaterThan(1_500);
    expect(result.currentUsageRateCents).toBeCloseTo(30, 1);
  });

  it("never hides a live modeled/device load that exceeds the historical hour", () => {
    const today = "2026-08-15";
    const records = Array.from({ length: 30 }, (_, index) => dailyRecord(today, index + 1, 12));
    const result = calibratePowershopEstimates(records, {
      ...options(today),
      fallbackCurrentCostPerHourNzd: 1.4,
      fallbackCurrentWatts: 4_000,
    });

    expect(result.currentWatts).toBe(4_000);
    expect(result.currentCostPerHourNzd).toBeGreaterThanOrEqual(1.4);
  });

  it("uses retailer actuals for completed billing days and forecasts only the remainder", () => {
    const today = "2026-08-15";
    const records = Array.from({ length: 40 }, (_, index) => dailyRecord(today, index + 1, 20));
    const result = calibratePowershopEstimates(records, options(today));

    // The 29 completed billing days are exact retailer totals; only today is estimated.
    expect(result.month.kwh).toBeGreaterThan(29 * 20);
    expect(result.month.projectedKwh).toBeGreaterThanOrEqual(result.month.kwh);
    expect(result.month.projectedKwh).toBeLessThan(31 * 21);
  });

  it("falls back cleanly when no retailer history is available", () => {
    const today = "2026-08-15";
    const result = calibratePowershopEstimates([], options(today));

    expect(result.calibration).toMatchObject({ confidence: "modeled", historyDays: 0, source: "modeled" });
    expect(result.currentWatts).toBeGreaterThanOrEqual(500);
    expect(result.day.projectedKwh).toBeCloseTo(20, 1);
  });
});
