import { fetchVoiceHostJson } from "./client";
import type { CompanionComparison, CompanionPresence, CompanionRouteSummary, CompanionStatusSummary, RouteArmTiming } from "./types";

// The voice server is authoritative for where each reasoning pass currently
// runs: it ships its own per-pass defaults, and a dashboard that assumed one
// would show the wrong machine for any pass nobody had chosen yet. Its internal
// route modes are collapsed back to the three the operator picks from.
export async function fetchVoiceHostCompanionRoutes(): Promise<Record<string, string> | null> {
  const payload = await fetchVoiceHostJson("/v1/companion/status", "companion routing status");
  const routes = (payload as { routes?: Record<string, { mode?: string }> } | null)?.routes;
  if (!routes || typeof routes !== "object") return null;
  // Both flavours of "the phone does it" read back as Companion. They differ
  // only in what happens when the phone cannot answer, which is a safety
  // detail rather than a choice of machine — and `both` now means literally
  // both, so it can no longer stand in for "prefers the phone".
  const byMode: Record<string, string> = {
    local: "local",
    companion_only: "companion",
    companion_preferred: "companion",
    both: "both",
  };
  const effective: Record<string, string> = {};
  for (const [pass, route] of Object.entries(routes)) {
    const choice = route?.mode ? byMode[route.mode] : undefined;
    // `companion_fallback` and `disabled` have no dropdown equivalent. Left out
    // rather than mapped to a near-miss, so a route set outside this UI is not
    // misreported as something the operator could have chosen here.
    if (choice) effective[pass] = choice;
  }
  return effective;
}

// Telemetry older than this means the voice server has stopped believing the
// device is healthy. Mirrors its own staleness window.
const COMPANION_STALE_SECONDS = 180;

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Percentiles stay null when absent rather than becoming zero, so "nothing has
// run here" is never displayed as "instant".
function readArm(value: unknown): RouteArmTiming {
  const record = (value ?? {}) as Record<string, unknown>;
  const number = (key: string) =>
    typeof record[key] === "number" && Number.isFinite(record[key])
      ? (record[key] as number)
      : null;
  return { n: toNumber(record.n), p50: number("p50"), p95: number("p95") };
}

// A presence reading that does not parse becomes null, never a state. There is
// no safe direction in which to guess where someone is, and a malformed
// payload is not evidence of anything.
function readPresence(value: unknown): CompanionPresence | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (state !== "home" && state !== "away" && state !== "unknown") return null;
  return {
    state,
    source: typeof record.source === "string" ? record.source : "none",
    ageSeconds: typeof record.ageSeconds === "number" ? record.ageSeconds : null,
    detail: typeof record.detail === "string" ? record.detail : "",
    // Defaults to false: a reading that does not say whether it is actionable
    // must not be acted on.
    actionable: record.actionable === true,
  };
}

/**
 * Shape the voice server's status payload for the browser.
 *
 * Separate from the fetch so it can be tested against fixtures: the transport
 * speaks node `https` with an mTLS identity and is exercised elsewhere, while
 * the part that can be wrong in an interesting way is this — what gets dropped,
 * what gets defaulted, and what `reportingStalled` concludes.
 */
export function summariseCompanionStatus(
  payload: Record<string, unknown> | null,
): CompanionStatusSummary | null {
  if (!payload || typeof payload !== "object") return null;

  const routes = (payload.routes ?? {}) as Record<string, Record<string, unknown>>;
  const counters = (payload.counters ?? {}) as Record<string, Record<string, unknown>>;
  const timings = (payload.timings ?? {}) as Record<string, Record<string, unknown>>;
  const comparing = new Set(
    (Array.isArray(payload.comparing) ? payload.comparing : []).map(String),
  );
  const routeSummaries: CompanionRouteSummary[] = Object.entries(routes).map(
    ([pass, route]) => {
      const counter = counters[pass] ?? {};
      const timing = timings[pass] ?? {};
      return {
        pass,
        mode: String(route?.mode ?? "unknown"),
        companionMs: readArm(timing.companion),
        localMs: readArm(timing.local),
        fallbackOverheadMs: readArm(timing.fallbackOverhead),
        comparing: comparing.has(pass),
        eligibility: String(route?.eligibility ?? ""),
        offered: toNumber(counter.offered),
        accepted: toNumber(counter.accepted),
        rejected: toNumber(counter.rejected),
        completed: toNumber(counter.completed),
        failed: toNumber(counter.failed),
        fellBack: toNumber(counter.fellBack),
        paused: counter.paused === true,
      };
    },
  );

  const telemetryAge =
    typeof payload.telemetryAgeSeconds === "number" ? payload.telemetryAgeSeconds : null;
  const connected = payload.connected === true;

  return {
    enabled: payload.enabled === true,
    forceLocal: payload.forceLocal === true,
    connected,
    identity: typeof payload.identity === "string" ? payload.identity : null,
    locality: typeof payload.locality === "string" ? payload.locality : null,
    tier: typeof payload.tier === "string" ? payload.tier : null,
    tierReason: typeof payload.tierReason === "string" ? payload.tierReason : null,
    appVersion: typeof payload.appVersion === "string" ? payload.appVersion : null,
    osVersion: typeof payload.osVersion === "string" ? payload.osVersion : null,
    workloads: Array.isArray(payload.workloads) ? payload.workloads.map(String) : [],
    telemetryAgeSeconds: telemetryAge,
    heartbeatAgeSeconds:
      typeof payload.lastHeartbeatAgeSeconds === "number"
        ? payload.lastHeartbeatAgeSeconds
        : null,
    activeAttempts: toNumber(payload.activeAttempts),
    routes: routeSummaries.sort((left, right) => left.pass.localeCompare(right.pass)),
    presence: readPresence(payload.presence),
    comparisons: Array.isArray(payload.comparisons)
      ? (payload.comparisons as CompanionComparison[])
      : [],
    reportingStalled: connected && telemetryAge !== null && telemetryAge > COMPANION_STALE_SECONDS,
  };
}

export async function fetchVoiceHostCompanionStatus(): Promise<CompanionStatusSummary | null> {
  const payload = (await fetchVoiceHostJson("/v1/companion/status", "companion status")) as
    | Record<string, unknown>
    | null;
  return summariseCompanionStatus(payload);
}
