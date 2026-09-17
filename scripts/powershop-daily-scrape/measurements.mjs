/**
 * Reading kWh, cost and billing metadata out of captured GraphQL responses.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import { isDateKey } from "./cli.mjs";
import { MEASUREMENT_COST_TYPES } from "./constants.mjs";

export function renderTemplate(value, variables) {
  return String(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => variables[name] ?? "");
}

export function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

export function looksLikeDate(value, targetDate) {
  return typeof value === "string" && value.slice(0, 10) === targetDate;
}

export function measurementDateKey(node) {
  for (const field of ["startAt", "readAt", "endAt"]) {
    if (typeof node?.[field] === "string" && /^\d{4}-\d{2}-\d{2}/.test(node[field])) {
      return node[field].slice(0, 10);
    }
  }
  return null;
}

export function measurementCostCents(node) {
  return (node?.metaData?.statistics ?? [])
    .filter((statistic) => MEASUREMENT_COST_TYPES.has(statistic?.type))
    .reduce((sum, statistic) => sum + (numberOrNull(statistic?.costInclTax?.estimatedAmount) ?? 0), 0);
}

function measurementCostCentsByType(node, type) {
  return (node?.metaData?.statistics ?? [])
    .filter((statistic) => statistic?.type === type)
    .reduce((sum, statistic) => sum + (numberOrNull(statistic?.costInclTax?.estimatedAmount) ?? 0), 0);
}

export function extractIntervalsForDate(capturedResponses, targetDate) {
  const intervals = new Map();
  const seenMeasurements = new Set();
  for (const response of capturedResponses) {
    const edges = response?.body?.data?.account?.property?.measurements?.edges;
    if (!Array.isArray(edges)) {
      continue;
    }
    for (const { node } of edges) {
      const kwh = numberOrNull(node?.value);
      const startAt = typeof node?.startAt === "string" ? node.startAt : null;
      const endAt = typeof node?.endAt === "string" ? node.endAt : null;
      if (measurementDateKey(node) !== targetDate || kwh === null || !startAt || !endAt || String(node?.unit).toLowerCase() !== "kwh") {
        continue;
      }
      const usageCostCents = measurementCostCentsByType(node, "CONSUMPTION_COST");
      const standingCostCents = measurementCostCentsByType(node, "STANDING_CHARGE_COST");
      const filters = node?.metaData?.utilityFilters ?? {};
      const signature = [startAt, endAt, filters.deviceId, filters.registerId, kwh, usageCostCents, standingCostCents].join("|");
      if (seenMeasurements.has(signature)) {
        continue;
      }
      seenMeasurements.add(signature);
      const intervalKey = `${startAt}|${endAt}`;
      const previous = intervals.get(intervalKey) ?? { costNzd: 0, kwh: 0, standingCostNzd: 0, usageCostNzd: 0 };
      intervals.set(intervalKey, {
        costNzd: Math.round((previous.costNzd + (usageCostCents + standingCostCents) / 100) * 10_000) / 10_000,
        endAt,
        kwh: Math.round((previous.kwh + kwh) * 1_000_000) / 1_000_000,
        standingCostNzd: Math.round((previous.standingCostNzd + standingCostCents / 100) * 10_000) / 10_000,
        startAt,
        usageCostNzd: Math.round((previous.usageCostNzd + usageCostCents / 100) * 10_000) / 10_000,
      });
    }
  }
  return Array.from(intervals.values()).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function extractAccountMetadata(capturedResponses) {
  for (const response of [...capturedResponses].reverse()) {
    const billing = response?.body?.data?.account?.billingOptions;
    if (
      billing &&
      isDateKey(billing.currentBillingPeriodStartDate) &&
      isDateKey(billing.currentBillingPeriodEndDate)
    ) {
      return {
        billing: {
          currentPeriodEndDate: billing.currentBillingPeriodEndDate,
          currentPeriodStartDate: billing.currentBillingPeriodStartDate,
          isFixed: Boolean(billing.isFixed),
          nextBillingDate: isDateKey(billing.nextBillingDate) ? billing.nextBillingDate : null,
          periodStartDay: Number.isInteger(billing.periodStartDay) ? billing.periodStartDay : null,
        },
        capturedAt: new Date().toISOString(),
        schemaVersion: 1,
        source: "powershop",
      };
    }
  }
  return null;
}
