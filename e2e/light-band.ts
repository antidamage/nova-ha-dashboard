import { hsvToRgb } from "../app/components/colorEncoderModel";

/** `--re-ring-empty` on the dark skin: the band past the mark. */
const RING_EMPTY: [number, number, number] = [0x1e, 0x20, 0x24];

/**
 * What the lights' band shows at 3 o'clock (specs/light-encoder.md): it fills
 * from the channel's zero point to the mark in the colour at full value. 3
 * o'clock is 225° past 7:30 on the 0–100 channels and 90° past 12 on hue. Solid
 * fill short of the mark, the empty channel past it, and null inside the soft
 * ends, where there is nothing exact to check.
 */
export function bandAtThreeOClock(channel: string, h: number, s: number, v: number): [number, number, number] | null {
  const sampleAt = channel === "hue" ? 90 : 225;
  const mark = channel === "hue" ? h : 2.7 * (channel === "saturation" ? s : v);
  if (mark - 12 > sampleAt) return hsvToRgb(h, s, 100);
  if (mark + 12 < sampleAt) return RING_EMPTY;
  return null;
}
