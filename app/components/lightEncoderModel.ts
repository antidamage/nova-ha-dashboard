/**
 * The lighting knob's ring: the whole ring in the light's colour, and the same
 * colour blurred for its glow (specs/light-encoder.md, "The ring is the light's
 * colour"). The base's ring shade lies over it, as on the climate knob.
 */
import type { Hsva } from "./colorEncoderModel";
import { hsvToRgb } from "./colorEncoderModel";
import { clamp } from "./useHsvaDial";

/** A solid paint of `rgb` at `alpha`, as a background layer. */
export function lightSolidPaint(rgb: [number, number, number], alpha = 1) {
  const on = `rgba(${rgb.join(", ")}, ${alpha.toFixed(3)})`;
  return `linear-gradient(${on}, ${on})`;
}

/**
 * The ring's paint and glow. The colour is the light's hue and saturation at
 * full value, so a dim light still shows its colour; brightness keys the glow.
 */
export function lightBand(colour: Hsva) {
  const rgb = hsvToRgb(colour.h, colour.s, 100);
  const glowAmount = clamp((colour.v - 50) / 50, 0, 1);
  return {
    paint: lightSolidPaint(rgb),
    glowPaint: lightSolidPaint(rgb, 0.9 * glowAmount),
  };
}
