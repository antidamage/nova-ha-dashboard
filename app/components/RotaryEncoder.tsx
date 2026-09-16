"use client";

/**
 * RotaryEncoder — facade. The body lives in controls/rotary/; this file keeps
 * the import path stable (specs/agent-token-footprint.md §3.3).
 *
 *   controls/rotary/types.ts             props, LED, range, ring and geometry shapes
 *   controls/rotary/constants.ts         sizes, feel, tuck-away timings, ring constants
 *   controls/rotary/encoder-model.ts     clamp, clock, turn maths, annulus clip
 *   controls/rotary/geometry-model.ts    ring geometry and pointer maths
 *   controls/rotary/ring-drag-model.ts   ring drag sample, fraction/value mapping
 *   controls/rotary/useKnobSkin.ts       light/dark treatment
 *   controls/rotary/useTuckAway.ts       lock, idle timer, ring layer timing
 *   controls/rotary/useFaceTopFit.ts     face text cut to fit
 *   controls/rotary/useTitleFit.ts       title arc cut to fit
 *   controls/rotary/RotaryEncoder.tsx    the dial: drag, click rules, rings, render
 */
export {
  ENCODER_MAX_SIZE,
  ENCODER_MIN_SIZE,
  TOGGLE_FADE_MS,
  TUCK_RING_MS,
  TUCK_RING_STAGGER_MS,
  UNLOCK_MAX_MS,
  UNLOCK_MIN_MS,
} from "./controls/rotary/constants";
export type {
  EncoderLed,
  EncoderRange,
  RotaryEncoderProps,
  RotaryEncoderRing,
  RotaryEncoderRingKind,
} from "./controls/rotary/types";
export { RotaryEncoder } from "./controls/rotary/RotaryEncoder";
