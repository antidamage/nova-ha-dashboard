import type { DashboardEntity, DashboardZone } from "../../../../lib/types";
import { WHITE_RULE_VALUE, type ZoneLightRule, type ZoneLightRuleKind } from "../../../../lib/zone-light-rules";
import { BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT, type SpectrumValue } from "../lighting";
import { KIND_LABELS } from "./constants";

/**
 * Whether a zone's reported brightness has reached what was set. The zone value
 * is an average over its lit fixtures, so allow for per-fixture rounding of the
 * commanded percent into Home Assistant's `0..255` scale.
 */
export function brightnessPctConverged(remotePct: number, localPct: number) {
  return Math.abs(remotePct - localPct) <= BRIGHTNESS_CONVERGENCE_TOLERANCE_PCT;
}

export function spectrumValuesEqual(left: SpectrumValue, right: SpectrumValue) {
  return (
    left.cursor.x === right.cursor.x &&
    left.cursor.y === right.cursor.y &&
    left.preview[0] === right.preview[0] &&
    left.preview[1] === right.preview[1] &&
    left.preview[2] === right.preview[2]
  );
}

export function offsetLabel(minutes: number) {
  if (minutes === 0) return "on the dot";
  const sign = minutes < 0 ? "−" : "+";
  return `${sign}${Math.abs(minutes)} min`;
}

export function newRule(kind: ZoneLightRuleKind, zone: DashboardZone, lights: DashboardEntity[]): ZoneLightRule {
  const base = { id: "", zoneId: zone.id, enabled: true, name: KIND_LABELS[kind] };
  const firstLight = lights[0]?.entity_id;
  switch (kind) {
    case "event":
      return { ...base, kind, at: { kind: "clock", hhmm: "18:00" }, days: [], value: { hue: 30, saturation: 60, brightnessPct: 60 } };
    case "adaptive":
      return { ...base, kind };
    case "threshold":
      return { ...base, kind, thresholdPct: 50, entityIds: firstLight ? [firstLight] : [] };
    case "pinned":
      return { ...base, kind, entityIds: firstLight ? [firstLight] : [] };
    default:
      return { ...base, kind: "preset", value: { ...WHITE_RULE_VALUE, hue: 30, saturation: 60 }, preset: { show: true, order: 0 } };
  }
}
