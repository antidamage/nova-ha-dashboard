/**
 * The LED line along a ring thumb (specs/color-encoder.md, "The thumb's LED
 * line"): which state it is in, and where it runs.
 */
import { THUMB_GROOVE_MIN_PX } from "./constants";

/** `lit` with a filled track, `grabbed` while held, `dark` otherwise. */
export type ThumbLed = "lit" | "grabbed" | "dark";

export function thumbLed(request: {
  kind: "slider" | "selector";
  /** Where the thumb is drawn along its range, 0 to 1. */
  fraction: number;
  /** A selector's whole-track fill, or null for an empty well. */
  fill: string | null;
  disabled: boolean;
  grabbed: boolean;
}): ThumbLed {
  const { kind, fraction, fill, disabled, grabbed } = request;
  // A disabled ring, or dial, emits nothing; it cannot be grabbed either.
  if (disabled) return "dark";
  // A held thumb is not inactive, whatever its value (alex's "glow brighter
  // when being dragged"): it goes dark on release if the track is empty.
  if (grabbed) return "grabbed";
  // Lit exactly when the track carries a fill (alex, 2026-11-07).
  const filled = kind === "slider" ? fraction > 0 : Boolean(fill);
  return filled ? "lit" : "dark";
}

/**
 * Half the line's angular length in degrees: the thumb's length less one
 * thumb thickness, centred on the thumb.
 */
export function thumbLedHalfAngle(radius: number, thumbLength: number, thumbThickness: number) {
  if (radius <= 0) return 0;
  const length = Math.max(0, thumbLength - thumbThickness);
  return (length / 2 / radius) * (180 / Math.PI);
}

/** Whether a thumb this thick has room for the groove round its line. */
export function thumbHasGroove(thumbThickness: number) {
  return thumbThickness >= THUMB_GROOVE_MIN_PX;
}
