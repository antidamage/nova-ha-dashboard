"use client";

/**
 * Dot controls — facade. The bodies live in controls/dots/ (specs/agent-token-footprint.md §3.3).
 *
 *   controls/dots/types.ts                  Rgb, Cursor, PrecisionDrag, EnvelopeDurations
 *   controls/dots/constants.ts              dimensions and timings
 *   controls/dots/dot-model.ts              precision drag, easing, inset and dot maths
 *   controls/dots/useRemoteEasedNumber.ts   1D remote easing
 *   controls/dots/useEasedCursor.ts         2D remote easing
 *   controls/dots/DotLineControl.tsx        single-thumb slider
 *   controls/dots/DotRangeControl.tsx       min/max slider
 *   controls/dots/DotEnvelopeControl.tsx    attack/hold/release timeline
 *   controls/dots/DotSpectrumControl.tsx    spectrum pad
 */
export { precisionDragScale } from "./controls/dots/dot-model";
export { DotLineControl } from "./controls/dots/DotLineControl";
export { DotRangeControl } from "./controls/dots/DotRangeControl";
export type { EnvelopeDurations } from "./controls/dots/types";
export { DotEnvelopeControl } from "./controls/dots/DotEnvelopeControl";
export { DotSpectrumControl } from "./controls/dots/DotSpectrumControl";
