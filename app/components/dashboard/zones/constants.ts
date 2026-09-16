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
