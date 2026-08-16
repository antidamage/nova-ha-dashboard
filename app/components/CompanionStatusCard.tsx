"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CompanionRouteSummary,
  CompanionStatusSummary,
  RouteArmTiming,
} from "../../lib/voice-host-settings";

// Why this card exists rather than a connected/disconnected dot: the companion
// has four states that look identical from outside and need four different
// responses — not connected (open the app), connected but not reporting (a
// client fault), connected and too flat or hot to help (wait, or plug it in),
// and connected and healthy but routed local on purpose (nothing is wrong).
// A dot collapses all four into "not working", which is the reading that costs
// an afternoon.

type Payload = {
  voiceHost: { ok: boolean };
  status: CompanionStatusSummary | null;
};

const REFRESH_MS = 15_000;

function age(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

const LOCALITY_LABELS: Record<string, string> = {
  home_lan: "On the home network",
  tailnet: "Away, over the private network",
  other: "On an unrecognised network",
};

const MODE_LABELS: Record<string, string> = {
  local: "Voice server",
  companion_preferred: "Companion, falling back",
  both: "Both — running on each, comparing",
  companion_only: "Companion only",
  companion_fallback: "Voice server, then companion",
  disabled: "Off",
};

/** The one line that says what to do about it, if anything. */
function headline(status: CompanionStatusSummary): { text: string; tone: "ok" | "warn" | "idle" } {
  if (!status.enabled) return { text: "Companion offloading is switched off", tone: "idle" };
  if (status.forceLocal) {
    return { text: "Force-local is on — nothing is being offered to the device", tone: "warn" };
  }
  if (!status.connected) {
    // There is no remote wake on this provisioning path, so this is the honest
    // instruction rather than "reconnecting…".
    return { text: "Not connected — open the companion app on the device", tone: "idle" };
  }
  if (status.reportingStalled) {
    return {
      text: "Connected but not reporting — this is a fault on the device, not a sleeping phone",
      tone: "warn",
    };
  }
  if (status.tier === "off") {
    return { text: `Connected, but standing down: ${status.tierReason ?? "unknown"}`, tone: "warn" };
  }
  return { text: `Ready — ${status.tierReason ?? status.tier ?? "healthy"}`, tone: "ok" };
}

const PRESENCE_LABELS: Record<string, string> = {
  home: "Home",
  away: "Out",
  unknown: "Not known",
};

// "Unknown" is deliberately neutral rather than a warning. It is the correct
// answer most of the time — a phone that is not connected says nothing about
// where anyone is — and colouring it as a problem would train the owner to
// treat the normal state as a fault.
const PRESENCE_CLASS: Record<string, string> = {
  home: "text-emerald-400",
  away: "text-neutral-300",
  unknown: "text-neutral-500",
};

function arm(timing: RouteArmTiming): string {
  // "no runs" rather than a dash: an empty arm is a fact about the route, not
  // a rendering gap.
  if (!timing.n || timing.p50 === null) return "no runs";
  const p50 = timing.p50 >= 1000 ? `${(timing.p50 / 1000).toFixed(1)}s` : `${Math.round(timing.p50)}ms`;
  return `${p50} (n=${timing.n})`;
}

/**
 * Which side is quicker — but only once both have enough samples to mean it.
 *
 * Calling a winner off two runs each would be noise dressed as a finding, and
 * the whole point of showing this is that someone might act on it.
 */
function faster(route: CompanionRouteSummary): "companion" | "local" | null {
  const { companionMs, localMs } = route;
  if (companionMs.n < 5 || localMs.n < 5) return null;
  if (companionMs.p50 === null || localMs.p50 === null) return null;
  // Within a tenth of each other is a tie, not a win.
  const ratio = companionMs.p50 / localMs.p50;
  if (ratio > 0.9 && ratio < 1.1) return null;
  return ratio < 1 ? "companion" : "local";
}

const TONE_CLASS: Record<"ok" | "warn" | "idle", string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  idle: "text-neutral-400",
};

function ComparisonSide({
  label,
  spoken,
  text,
  elapsedMs,
}: {
  label: string;
  spoken: boolean;
  text: string | null;
  elapsedMs: number | null;
}) {
  return (
    <div className="border-l-2 border-neutral-700 pl-2">
      <p className="text-[11px] text-neutral-500">
        {label}
        {elapsedMs !== null ? ` · ${Math.round(elapsedMs)}ms` : ""}
        {spoken ? " · spoken" : ""}
      </p>
      <p className={`text-xs leading-snug ${spoken ? "text-neutral-200" : "text-neutral-400"}`}>
        {text ?? "(no answer)"}
      </p>
    </div>
  );
}

export default function CompanionStatusCard() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/companion-status", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setPayload((await response.json()) as Payload);
      setFailed(false);
    } catch {
      // A failed poll is not evidence the device is gone — it is evidence this
      // browser could not ask. Saying so beats showing a stale "disconnected".
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (failed || (payload && !payload.voiceHost.ok)) {
    return (
      <p className="px-1 text-xs leading-snug text-neutral-500">
        The voice server did not answer, so the companion&apos;s state is unknown. This says
        nothing about the device itself.
      </p>
    );
  }

  if (!payload?.status) {
    return <p className="px-1 text-xs leading-snug text-neutral-500">Checking the companion…</p>;
  }

  const status = payload.status;
  const summary = headline(status);

  return (
    <div className="grid gap-2">
      <p className={`px-1 text-xs font-black uppercase leading-snug ${TONE_CLASS[summary.tone]}`}>
        {summary.text}
      </p>

      {status.connected ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-1 text-xs text-neutral-400">
          <dt className="text-neutral-500">Device</dt>
          <dd className="text-right">{status.identity ?? "unknown"}</dd>
          <dt className="text-neutral-500">Network</dt>
          <dd className="text-right">
            {LOCALITY_LABELS[status.locality ?? ""] ?? status.locality ?? "unknown"}
          </dd>
          <dt className="text-neutral-500">Last reported</dt>
          <dd className="text-right">{age(status.telemetryAgeSeconds)}</dd>
          {status.appVersion ? (
            <>
              <dt className="text-neutral-500">App</dt>
              <dd className="text-right">
                {status.appVersion}
                {status.osVersion ? ` · iOS ${status.osVersion}` : ""}
              </dd>
            </>
          ) : null}
          {status.activeAttempts > 0 ? (
            <>
              <dt className="text-neutral-500">Running now</dt>
              <dd className="text-right">{status.activeAttempts}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {status.presence ? (
        <div className="grid gap-0.5 px-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-neutral-500">Someone home?</span>
            <span className={PRESENCE_CLASS[status.presence.state]}>
              {PRESENCE_LABELS[status.presence.state]}
            </span>
          </div>
          {/* The reason, not just the verdict. "Unknown" is a real answer and
              the owner needs to know which kind of unknown it is before
              wiring anything to it. */}
          <p className="text-[11px] leading-snug text-neutral-600">
            {status.presence.detail}
          </p>
        </div>
      ) : null}

      {status.comparisons.length ? (
        <div className="grid gap-2 px-1">
          <p className="text-xs font-black uppercase text-neutral-400">
            Both answers, newest first
          </p>
          {[...status.comparisons].reverse().slice(0, 5).map((entry) => (
            <div key={`${entry.workload}-${entry.at}`} className="grid gap-1">
              <p className="text-[11px] text-neutral-500">
                {entry.workload} · {new Date(entry.at).toLocaleTimeString()}
              </p>
              {/* Tagged by route, and the spoken one is marked — otherwise a
                  reader has no way to tell which of the two the house
                  actually heard. */}
              <ComparisonSide
                label="Device"
                spoken={entry.spoken === "companion"}
                text={entry.companion.text}
                elapsedMs={entry.companion.elapsedMs}
              />
              <ComparisonSide
                label="Voice server"
                spoken={entry.spoken === "local"}
                text={entry.local.text}
                elapsedMs={entry.local.elapsedMs}
              />
            </div>
          ))}
        </div>
      ) : null}

      {status.routes.length ? (
        <div className="grid gap-1 px-1">
          {status.routes.map((route) => (
            <div key={route.pass} className="grid gap-0.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-neutral-300">{route.pass}</span>
                <span className="text-neutral-500">
                  {MODE_LABELS[route.mode] ?? route.mode}
                </span>
              </div>
              {/* The voice server's own words for the exact gate. Paraphrasing
                  it here would put a second, drifting explanation next to the
                  authoritative one. */}
              <p className="text-[11px] leading-snug text-neutral-600">
                {route.eligibility}
                {route.paused ? " · paused by repeated failures" : ""}
              </p>
              {route.offered || route.fellBack ? (
                <p className="text-[11px] leading-snug text-neutral-600">
                  {route.completed} done on the device · {route.fellBack} run here
                  {route.rejected ? ` · ${route.rejected} declined` : ""}
                  {route.failed ? ` · ${route.failed} failed` : ""}
                </p>
              ) : null}
              {/* The comparison, when there is one to make. Both arms are
                  timed separately, so a fallback's wasted attempt shows up as
                  its own number rather than making the voice server look
                  slow. */}
              {route.companionMs.n || route.localMs.n ? (
                <p className="text-[11px] leading-snug text-neutral-500">
                  <span className={faster(route) === "companion" ? "text-emerald-400" : ""}>
                    device {arm(route.companionMs)}
                  </span>
                  {" · "}
                  <span className={faster(route) === "local" ? "text-emerald-400" : ""}>
                    here {arm(route.localMs)}
                  </span>
                  {route.fallbackOverheadMs.n
                    ? ` · wasted on failed tries ${arm(route.fallbackOverheadMs)}`
                    : ""}
                </p>
              ) : null}
              {route.comparing ? (
                <p className="text-[11px] leading-snug text-amber-400">
                  Comparing — both are running this pass, so the slot is not being freed.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
