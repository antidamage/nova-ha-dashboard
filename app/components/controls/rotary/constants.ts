/** RotaryEncoder's numbers: sizes, feel, tuck-away timings and ring geometry constants. */
import { TAP_MAX_MS } from "../../sliderTapGesture";

export const RING_LIMIT = 5;

/** Each track runs 7:30 → over the top → 4:30; the bottom 90° holds labels. */
export const ARC_START = -135;
export const ARC_END = 135;
export const ARC_SPAN = ARC_END - ARC_START;

/** A shortened ring never gets smaller than this, or it stops reading as a ring. */
export const ARC_MIN_SPAN = 180;

/** Track and gap as fractions of the knob diameter, before the pitch floor. */
export const TRACK_SHARE = 0.06;
export const GAP_SHARE = 0.025;

/**
 * The dial's ring stack, as shares of the knob diameter. `rotary-encoder.css`
 * carries the same numbers as its `--re-*` custom properties, and
 * `unlockRingGeometry.test.ts` fails if the two ever drift apart.
 */
export const RING_SHARE = 0.1;
export const BEVEL_SHARE = 0.022;
/**
 * The embossed unlock ring: a thin band of polished glass between the knob's
 * lip and the colour ring, dark until the dial unlocks and then lit in the LED
 * colour. Adding it pushed the colour ring, the outer bevel and every slider
 * ring out by exactly this much, so the outer layers keep the arrangement they
 * had (Adeline, 2026-09-20).
 */
export const UNLOCK_RING_SHARE = 0.035;
/**
 * Where the stack ends: the slider rings' band starts here and the dial's own
 * footprint is `2 x` it. Half the knob, then unlock ring, colour ring, bevel.
 */
export const DIAL_RADIUS_SHARE = 0.5 + UNLOCK_RING_SHARE + RING_SHARE + BEVEL_SHARE;
/**
 * `--re-outer` over the knob diameter. A caller that has to lay the dial out
 * itself — the status orb puts the color ring on its rim — divides by this.
 */
export const DIAL_OUTER_RATIO = 2 * DIAL_RADIUS_SHARE;

/** Thumb thickness and visible length (round ends included), in track widths. */
export const THUMB_THICKNESS = 1.3;
export const THUMB_LENGTH = 2.4;

/** Clearance between a ring's label and its value, in label font sizes. */
export const LABEL_VALUE_CLEARANCE = 1.5;

/**
 * Clearance above and below the title arc, as a fraction of the knob diameter
 * (specs/color-encoder.md, "The title arcs over the knob"). The band the title
 * claims is the caption font plus one of these each side, and the slider rings
 * all move out by it.
 */
export const TITLE_CLEARANCE_SHARE = 0.02;

/** Clearance at each end of the title arc, in title font sizes. */
export const TITLE_END_CLEARANCE = 1;

export const ENCODER_MIN_SIZE = 50;
export const ENCODER_MAX_SIZE = 200;

/** Nearer the centre than this share of the knob's radius, a sample is noise. */
export const DEAD_CENTRE_SHARE = 0.15;

/** Shift or Alt makes every channel, and every ring, this much finer. */
export const FINE_DIVISOR = 8;

/** Keyboard nudge, in degrees of turn: 5.4° is 2% of a 270° sweep. */
export const KEY_STEP_DEG = 5.4;

/**
 * Three periods, not "…": at 10px, letter-spaced and etched, the single glyph
 * reads as a dash, so a cut label looked broken rather than shortened.
 */
export const ELLIPSIS = "...";

/** Tuck-away timings (specs/color-encoder.md, "Tuck-away"). */
export const TUCK_RING_MS = 450;
export const TUCK_RING_STAGGER_MS = 150;
/** The unlocking tap's press must last between these, so a brush never opens it. */
export const UNLOCK_MIN_MS = 60;
export const UNLOCK_MAX_MS = TAP_MAX_MS;
/** Fades a toggle ring's fill in and out. */
export const TOGGLE_FADE_MS = 500;

/**
 * How fast a stepping ring's thumb travels to the stop it has been aimed at, in
 * degrees of its own arc per second. One rate for every ring and every step, so
 * the distance a step covers is what decides how long it takes: a long step
 * visibly takes longer, a short one is over almost at once. A full 270° sweep
 * takes 375ms, the aircon Mode ring's 90° stop 125ms.
 *
 * It is a speed rather than a duration on purpose — a step is a distance, and an
 * eased duration would make a two-stop jump look exactly like a one-stop jump,
 * which is the thing this exists to show (Adeline, 2026-09-21). See
 * `ring-glide-model.ts` and `useRingGlide.ts`.
 */
export const RING_GLIDE_DEG_PER_SEC = 720;

/**
 * How coarse a `step` has to be for its ring to glide at all, as a share of the
 * ring's range.
 *
 * A `step` is not the same thing as a discrete control. The sleep-timer rings
 * round to 2 minutes across an eight-hour range — 0.4% of it — which is
 * rounding rather than a set of stops. A ring like that is dragged by eye and has
 * to track the finger exactly. Gliding them would cap the thumb at
 * the same 720°/s and leave the readout running ahead of it for the whole
 * gesture, which is a regression at a 1° step and buys nothing (Adeline,
 * 2026-09-21, reviewing the first version of this ruling on any step at all).
 *
 * 1/30 keeps the aircon Mode ring (1 of 3 stops) and its Fan ring (1 of 6) inside
 * and puts every rounding-only step outside. A caller that disagrees can say so
 * per ring with `glide`.
 */
export const RING_GLIDE_MIN_STEP_SHARE = 1 / 30;
