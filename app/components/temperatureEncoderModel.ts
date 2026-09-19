/**
 * The temperature knob's colour scale, ring paint and ring text
 * (specs/temperature-encoder.md).
 *
 * One scale carries both temperatures the dial shows, so the target in the ring's
 * top half and the room in its bottom half can be read against each other.
 */

/** Ice blue at 18°C, pale warm white at 22°C, orange-red at 26°C (Adeline). */
export const TEMPERATURE_SCALE_MIN = 18;
export const TEMPERATURE_SCALE_MID = 22;
export const TEMPERATURE_SCALE_MAX = 26;

export const TEMPERATURE_COLD = "#8ad8ff";
export const TEMPERATURE_MID = "#f6efe4";
export const TEMPERATURE_HOT = "#ff4a1c";
export type TargetRange = { min: number; max: number };

/** Bounds of the config "Knob range" slider: the widest hard range of any unit. */
export const PREFERRED_RANGE_MIN = 5;
export const PREFERRED_RANGE_MAX = 30;
export const PREFERRED_RANGE_MIN_GAP = 1;

/**
 * The range a knob sweeps: the household's preferred range inside the unit's
 * hard limits, or the hard limits when there is no preference or no overlap.
 */
/**
 * The target to DISPLAY for a stored value that sits outside the knob's range.
 *
 * Display only — it must never be written back. A stored target below the floor
 * is usually not a target the user chose at all: it is the card's own default,
 * read because preferences had not loaded yet. Sending the "corrected" value
 * then overwrote a real setting with a number nobody asked for, which is how
 * Adeline's bedroom target kept resetting to 19.
 *
 * No user gesture, no write. See specs/bedroom-heater-control-integrity.md §4.
 */
export function clampTargetForDisplay(
  target: number | null | undefined,
  range: TargetRange,
): number | null {
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  return Math.max(range.min, Math.min(range.max, target));
}

export function effectiveTargetRange(hard: TargetRange, preferred?: TargetRange | null): TargetRange {
  if (!preferred || !Number.isFinite(preferred.min) || !Number.isFinite(preferred.max)) return hard;
  const min = Math.max(hard.min, preferred.min);
  const max = Math.min(hard.max, preferred.max);
  return min < max ? { min, max } : hard;
}

/** No reading: the ring's bottom half goes dark rather than guessing. */
export const TEMPERATURE_UNKNOWN = "#1e2024";

/** The aircon's mode ring takes its colours from the same three. */
export const MODE_COOL_COLOUR = TEMPERATURE_COLD;
/** Pale lime (specs/temperature-encoder.md, round 2). */
export const MODE_DRY_COLOUR = "#d9f99d";
export const MODE_FAN_COLOUR = "#3a3d44";
export const MODE_HEAT_COLOUR = TEMPERATURE_HOT;

/** The two halves blend into each other over this much arc, at every size. */
export const RING_BLEND_PX = 30;

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

function rgbOf(hex: string) {
  return `rgb(${hexToRgb(hex).join(", ")})`;
}

function mix(from: string, to: string, t: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/**
 * The colour a temperature reads as, clamped at both ends of the scale. A null
 * reading is the dark charcoal, not an interpolated guess.
 */
export function temperatureColour(celsius: number | null | undefined) {
  if (typeof celsius !== "number" || !Number.isFinite(celsius)) return TEMPERATURE_UNKNOWN;
  if (celsius <= TEMPERATURE_SCALE_MIN) return rgbOf(TEMPERATURE_COLD);
  if (celsius >= TEMPERATURE_SCALE_MAX) return rgbOf(TEMPERATURE_HOT);
  if (celsius <= TEMPERATURE_SCALE_MID) {
    return mix(TEMPERATURE_COLD, TEMPERATURE_MID, (celsius - TEMPERATURE_SCALE_MIN) / (TEMPERATURE_SCALE_MID - TEMPERATURE_SCALE_MIN));
  }
  return mix(TEMPERATURE_MID, TEMPERATURE_HOT, (celsius - TEMPERATURE_SCALE_MID) / (TEMPERATURE_SCALE_MAX - TEMPERATURE_SCALE_MID));
}

/** Degrees of arc that `RING_BLEND_PX` covers on a knob of this size. */
export function blendAngle(size: number) {
  // The colour ring's centreline sits at 55% of the knob diameter from centre
  // (the knob's radius plus half a ring, and a ring is 10% of the diameter).
  const radius = size * 0.55;
  if (radius <= 0) return 0;
  return Math.min(80, (RING_BLEND_PX / radius) * (180 / Math.PI));
}

/**
 * The ring's paint: the target across the top half, the room temperature across
 * the bottom half, fading into each other at 3 and 9 o'clock. A conic gradient
 * starts at 12 o'clock and runs clockwise, which is the dial's own convention.
 */
export function temperatureRingPaint(target: number | null | undefined, room: number | null | undefined, size: number) {
  const top = temperatureColour(target);
  const bottom = temperatureColour(room);
  const half = blendAngle(size) / 2;
  return [
    "conic-gradient(from 0deg",
    `${top} 0deg`,
    `${top} ${(90 - half).toFixed(2)}deg`,
    `${bottom} ${(90 + half).toFixed(2)}deg`,
    `${bottom} ${(270 - half).toFixed(2)}deg`,
    `${top} ${(270 + half).toFixed(2)}deg`,
    `${top} 360deg)`,
  ].join(", ");
}

/** The ring's glow while the unit is running: the colour-dial's full-glow figures. */
export function temperatureGlow(target: number | null | undefined, size: number, running: boolean) {
  if (!running) return "0 0 0 rgba(0, 0, 0, 0)";
  const rgb = temperatureColour(target).replace(/rgb\(|\)/g, "");
  return `0 0 ${(size * 0.14).toFixed(1)}px ${(size * 0.012).toFixed(1)}px rgba(${rgb}, 0.62)`;
}

// ── The timer ring ──────────────────────────────────────────────────────────

export const TIMER_MAX_MINUTES = 240;
export const TIMER_STEP_MINUTES = 2;

/** Whole minutes left on a timer, rounded up; 0 once it has run out. */
export function timerMinutesRemaining(endsAt: string | null | undefined, now: number) {
  if (!endsAt) return 0;
  const at = new Date(endsAt).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 60000));
}

/** What the timer ring says on its right: `OFF`, or the minutes left. */
export function timerValueText(minutes: number) {
  return minutes <= 0 ? "OFF" : `${Math.round(minutes)} MIN`;
}

/** The widest it can ever be, so the ring's length never changes. */
export const TIMER_VALUE_WIDEST = `${TIMER_MAX_MINUTES} MIN`;

// ── The fan ring ────────────────────────────────────────────────────────────

const FAN_STEP_TEXT: Record<string, string> = {
  quiet: "QUIET",
  low: "LOW",
  "medium low": "MED LOW",
  medium: "MEDIUM",
  "medium high": "MED HIGH",
  high: "HIGH",
  turbo: "TURBO",
};

export function fanStepText(step: string) {
  return FAN_STEP_TEXT[step] ?? step.toUpperCase();
}

export const FAN_VALUE_WIDEST = "MED HIGH";
