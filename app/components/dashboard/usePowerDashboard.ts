"use client";

import { useEffect, useRef, useState } from "react";
import type { PowerDashboard } from "../../../lib/power";

type PowerPanelState = {
  data: PowerDashboard | null;
  error: string | null;
};

const POWER_POLL_INTERVAL_MS = 5_000;
const ZERO_POWER_ERROR = "Grid data unavailable; showing zeros";

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function zeroPeriod() {
  return {
    costNzd: 0,
    kwh: 0,
    projectedCostNzd: 0,
    projectedKwh: 0,
  };
}

export function zeroPowerDashboard(now = new Date()): PowerDashboard {
  const today = dateKey(now);

  return {
    baseLoad: {
      costPerDayNzd: 0,
      currentWatts: 0,
      devices: [],
      elapsedCostNzd: 0,
      elapsedKwh: 0,
      fixedCostPerDayNzd: 0,
      kwhPerDay: 0,
      usageCostPerDayNzd: 0,
    },
    billingCycle: {
      day: 1,
      days: 1,
      endDate: today,
      label: "Unavailable",
      startDate: today,
    },
    currentCostPerHourNzd: 0,
    currentRate: {
      cPerKwh: 0,
      dailyCents: 0,
      displayName: "Grid data unavailable",
      period: "anytime",
      sourceUrl: "",
    },
    currentWatts: 0,
    devices: [],
    estimation: {
      confidence: "modeled",
      halfLifeDays: 28,
      historyDays: 0,
      intervalDays: 0,
      lastActualDate: null,
      source: "modeled",
    },
    generatedAt: now.toISOString(),
    graph: [],
    accountUsageGraph: [],
    accountRateGraph: [],
    backgroundEstimateGraph: [],
    lastRateCheckAt: null,
    lastSampleAt: null,
    rateGraph: [],
    ratesWarning: ZERO_POWER_ERROR,
    summaries: {
      day: zeroPeriod(),
      month: zeroPeriod(),
      week: zeroPeriod(),
      yearToDate: zeroPeriod(),
    },
    totals: {
      costNzd: 0,
      kwh: 0,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPeriodSummary(value: unknown) {
  return isRecord(value) && isNumber(value.costNzd) && isNumber(value.kwh);
}

export function normalizePowerDashboard(value: unknown, now = new Date()) {
  if (!isRecord(value)) {
    return { data: zeroPowerDashboard(now), error: ZERO_POWER_ERROR };
  }

  const currentRate = isRecord(value.currentRate) ? value.currentRate : null;
  const summaries = isRecord(value.summaries) ? value.summaries : null;
  const valid =
    isRecord(value.baseLoad) &&
    isRecord(value.billingCycle) &&
    currentRate !== null &&
    isNumber(currentRate.cPerKwh) &&
    isNumber(value.currentWatts) &&
    Array.isArray(value.devices) &&
    isRecord(value.estimation) &&
    Array.isArray(value.graph) &&
    Array.isArray(value.accountUsageGraph) &&
    Array.isArray(value.accountRateGraph) &&
    Array.isArray(value.backgroundEstimateGraph) &&
    Array.isArray(value.rateGraph) &&
    summaries !== null &&
    isPeriodSummary(summaries.day) &&
    isPeriodSummary(summaries.week) &&
    isPeriodSummary(summaries.month) &&
    isPeriodSummary(summaries.yearToDate) &&
    isRecord(value.totals) &&
    isNumber(value.totals.costNzd) &&
    isNumber(value.totals.kwh);

  return valid
    ? { data: value as PowerDashboard, error: null }
    : { data: zeroPowerDashboard(now), error: ZERO_POWER_ERROR };
}

async function fetchPower() {
  const response = await fetch("/api/power", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to read power");
  }
  return normalizePowerDashboard(payload);
}

export function usePowerDashboard() {
  const [state, setState] = useState<PowerPanelState>({ data: null, error: null });
  const polling = useRef(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (polling.current || document.hidden) {
        return;
      }

      polling.current = true;
      try {
        const next = await fetchPower();
        if (alive) {
          setState(next);
        }
      } catch (error) {
        if (alive) {
          setState({
            data: zeroPowerDashboard(),
            error: error instanceof Error ? error.message : "Failed to read power",
          });
        }
      } finally {
        polling.current = false;
      }
    };

    void load();
    const timer = window.setInterval(load, POWER_POLL_INTERVAL_MS);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        void load();
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  return state;
}
