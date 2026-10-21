/**
 * The lighting knob's band: the light's colour filling from the channel's zero
 * point to the mark, soft at both ends, and the same arc blurred for its glow
 * (specs/light-encoder.md, "The band fills from the zero point to the mark").
 *
 * The stops are written against `var(--re-mark)` so the fill sweeps with the
 * index; `lightRingMark` is the number the base publishes as that property.
 */
import type { Hsva } from "./colorEncoderModel";
import { hsvToRgb } from "./colorEncoderModel";
import type { ColorEncoderChannel } from "./useHsvaDial";
import { clamp } from "./useHsvaDial";

/** Fade-in from the zero point, and the fade's full width at the mark. */
export const LIGHT_FILL_FADE_DEG = 24;

/** 7:30 for the 0–100 channels, 12 o'clock for hue (conic angles from 12). */
export function lightFillStart(channel: ColorEncoderChannel) {
  return channel === "hue" ? 0 : 225;
}

/** Degrees from the zero point to the mark. */
export function lightRingMark(channel: ColorEncoderChannel, colour: Hsva) {
  if (channel === "hue") return clamp(colour.h, 0, 360);
  const value = channel === "brightness" ? colour.v : channel === "saturation" ? colour.s : colour.a;
  return clamp(value, 0, 100) * 2.7;
}

/** The fill's arc in `rgb`, at `alpha`, soft at both ends. */
export function lightFillArc(channel: ColorEncoderChannel, rgb: [number, number, number], alpha = 1) {
  const on = `rgba(${rgb.join(", ")}, ${alpha.toFixed(3)})`;
  const off = `rgba(${rgb.join(", ")}, 0)`;
  const fadeIn = `min(${LIGHT_FILL_FADE_DEG}deg, var(--re-mark) * 0.5)`;
  const fadeOut = `min(${LIGHT_FILL_FADE_DEG / 2}deg, var(--re-mark) * 0.5)`;
  return [
    `conic-gradient(from ${lightFillStart(channel)}deg`,
    `${off} 0deg`,
    `${on} ${fadeIn}`,
    `${on} calc(var(--re-mark) - ${fadeOut})`,
    `${off} calc(var(--re-mark) + ${fadeOut})`,
    `${off} 360deg)`,
  ].join(", ");
}

/**
 * The band's paint and glow. The colour is the light's hue and saturation at
 * full value: the fill's length already says how bright it is.
 */
export function lightBand(channel: ColorEncoderChannel, colour: Hsva) {
  const rgb = hsvToRgb(colour.h, colour.s, 100);
  const glowAmount = clamp((colour.v - 50) / 50, 0, 1);
  return {
    mark: lightRingMark(channel, colour),
    paint: `${lightFillArc(channel, rgb)}, var(--re-ring-empty)`,
    glowPaint: lightFillArc(channel, rgb, 0.9 * glowAmount),
  };
}
