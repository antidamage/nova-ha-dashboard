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
