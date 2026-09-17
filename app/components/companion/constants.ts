"use client";

export const REFRESH_MS = 15_000;

export const LOCALITY_LABELS: Record<string, string> = {
  home_lan: "On the home network",
  tailnet: "Away, over the private network",
  other: "On an unrecognised network",
};

export const MODE_LABELS: Record<string, string> = {
  local: "Voice server",
  companion_preferred: "Companion, falling back",
  both: "Both — running on each, comparing",
  companion_only: "Companion only",
  companion_fallback: "Voice server, then companion",
  disabled: "Off",
};

export const PRESENCE_LABELS: Record<string, string> = {
  home: "Home",
  away: "Out",
  unknown: "Not known",
};

// "Unknown" is deliberately neutral rather than a warning. It is the correct
// answer most of the time — a phone that is not connected says nothing about
// where anyone is — and colouring it as a problem would train the owner to
// treat the normal state as a fault.
export const PRESENCE_CLASS: Record<string, string> = {
  home: "text-emerald-400",
  away: "text-neutral-300",
  unknown: "text-neutral-500",
};

export const TONE_CLASS: Record<"ok" | "warn" | "idle", string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  idle: "text-neutral-400",
};
