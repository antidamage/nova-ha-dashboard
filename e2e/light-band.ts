import { hsvToRgb } from "../app/components/colorEncoderModel";

/**
 * What the lights' ring shows at 3 o'clock (specs/light-encoder.md): the whole
 * ring is the light's hue and saturation at full value, whatever the channel
 * or value.
 */
export function bandAtThreeOClock(_channel: string, h: number, s: number, _v: number): [number, number, number] | null {
  return hsvToRgb(h, s, 100);
}
