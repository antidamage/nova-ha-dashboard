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

/** Each colour fades to nothing over this much arc at its outer end. */
export const RING_END_FADE_PX = 40;

/** Degrees of arc that `RING_END_FADE_PX` covers on a knob of this size. */
export function endFadeAngle(size: number) {
  return blendAngle(size) * (RING_END_FADE_PX / RING_BLEND_PX);
}

/** The knob's index as degrees past 7:30: the ring's mark. Mid-sweep without a range. */
export function temperatureRingMark(value: number, min: number, max: number) {
  if (!(max > min)) return 135;
  return ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 270;
}

/** A `temperatureColour` (an `rgb()` or a hex) at `alpha`. */
function rgba(colour: string, alpha: number) {
  const channels = colour.startsWith("#") ? hexToRgb(colour).join(", ") : colour.replace(/^rgb\((.*)\)$/, "$1");
  return `rgba(${channels}, ${alpha})`;
}

/** The target's arc from the mark's blend to 4:30, fading out before the end. */
function targetStops(colour: string, alpha: number, size: number) {
  const end = 270 - endFadeAngle(size);
  const half = blendAngle(size) / 2;
  return [
    `${rgba(colour, alpha)} calc(var(--re-mark) + ${half.toFixed(2)}deg)`,
    `${rgba(colour, alpha)} max(${end.toFixed(2)}deg, var(--re-mark) * 0.5 + 135deg)`,
    // At the top of the range the arc has no length left to fade over, so it
    // fades over one more blend past the mark rather than ending on a hard edge.
    `${rgba(colour, 0)} max(270deg, calc(var(--re-mark) + ${(half * 2).toFixed(2)}deg))`,
    `${rgba(colour, 0)} 360deg)`,
  ];
}

/**
 * The ring's paint, split at the mark (specs/temperature-encoder.md, "Colour
 * ring"): the room temperature from 7:30 to the mark, the target from the mark
 * to 4:30, each fading out at its outer end so the two never meet across the
 * bottom. Written against `var(--re-mark)`, so the split follows the index; the
 * conic starts at 7:30 (225° clockwise from 12).
 */
export function temperatureRingPaint(target: number | null | undefined, room: number | null | undefined, size: number) {
  const bottom = temperatureColour(room);
  return [
    "conic-gradient(from 225deg",
    `${rgba(bottom, 0)} 0deg`,
    `${rgba(bottom, 1)} min(${endFadeAngle(size).toFixed(2)}deg, var(--re-mark) * 0.5)`,
    `${rgba(bottom, 1)} calc(var(--re-mark) - ${(blendAngle(size) / 2).toFixed(2)}deg)`,
    ...targetStops(temperatureColour(target), 1, size),
  ].join(", ") + ", var(--re-ring-empty)";
}

/**
 * The ring's glow while the unit is running: the target's own arc, which the
 * base blurs, at the colour dial's full-glow alpha. Nothing while idle.
 */
export function temperatureGlowPaint(target: number | null | undefined, size: number, running: boolean) {
  if (!running) return "none";
  const colour = temperatureColour(target);
  return [
    "conic-gradient(from 225deg",
    `${rgba(colour, 0)} 0deg`,
    `${rgba(colour, 0)} calc(var(--re-mark) - ${(blendAngle(size) / 2).toFixed(2)}deg)`,
    ...targetStops(colour, 0.62, size),
  ].join(", ");
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
