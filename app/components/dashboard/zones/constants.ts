import type { ZoneLightRuleKind } from "../../../../lib/zone-light-rules";

export const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
export const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
export const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
export const SUN_OFFSETS = Array.from({ length: 17 }, (_, index) => (index - 8) * 15);
export const PERCENTS = Array.from({ length: 101 }, (_, pct) => String(pct));

export const KIND_LABELS: Record<ZoneLightRuleKind, string> = {
  event: "Timed event",
  adaptive: "Adaptive",
  threshold: "Intensity threshold",
  pinned: "Pinned",
  preset: "Preset",
};

/** No minimum, then 1 up to the zone's switchable lights, always including the stored value. */
export function minLightsOptions(zoneLightCount: number, current: number) {
  const top = Math.max(zoneLightCount, current);
  return Array.from({ length: top + 1 }, (_, count) => ({
    value: String(count),
    label: count === 0 ? "No minimum" : `${count} light${count > 1 ? "s" : ""} on`,
  }));
}
