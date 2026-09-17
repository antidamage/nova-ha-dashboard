"use client";

import type {
  CompanionRouteSummary,
  CompanionStatusSummary,
  RouteArmTiming,
} from "../../../lib/voice-host-settings";

export function age(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** The one line that says what to do about it, if anything. */
export function headline(status: CompanionStatusSummary): { text: string; tone: "ok" | "warn" | "idle" } {
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

export function arm(timing: RouteArmTiming): string {
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
export function faster(route: CompanionRouteSummary): "companion" | "local" | null {
  const { companionMs, localMs } = route;
  if (companionMs.n < 5 || localMs.n < 5) return null;
  if (companionMs.p50 === null || localMs.p50 === null) return null;
  // Within a tenth of each other is a tie, not a win.
  const ratio = companionMs.p50 / localMs.p50;
  if (ratio > 0.9 && ratio < 1.1) return null;
  return ratio < 1 ? "companion" : "local";
}
