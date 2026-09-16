// The configured electricity plan, the current rate, and the rate-source watch.
import crypto from "crypto";
import type { PowerTariff } from "../config-schema";
import { currentKeys, localParts } from "./calendar";
import { powerConfig } from "./store";
import type { PowerState, TariffPeriod } from "./types";

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
export function tariff(): PowerTariff | null {
  return powerConfig().rates.tariff ?? null;
}

export function currentRate(date: Date) {
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

export function rateCentsForMonth(year: number, monthIndex: number) {
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

export async function refreshPowerRatesIfDue(state: PowerState, now: Date, rate: ReturnType<typeof currentRate>) {
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
