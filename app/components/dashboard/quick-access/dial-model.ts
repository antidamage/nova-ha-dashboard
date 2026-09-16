"use client";

import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";

/**
 * A third bigger than the knob's 100px floor (Adeline, 2026-09-12): at the
 * floor the climate segments read as small beside the rest of the line, and the
 * dial is the one thing on the card you actually turn.
 */
export const QUICK_TEMPERATURE_SIZE = 133;
/**
 * The lighting dial matches the climate dials (Adeline, 2026-09-12): in
 * portrait the three sit in one evenly-spread row and a smaller one there
 * looked like a mistake. 56px at first, then 84 once the segment's written
 * title went, now the climate size.
 */
export const QUICK_ENCODER_SIZE = QUICK_TEMPERATURE_SIZE;

/**
 * The most rings any Quick Access knob carries: the Lounge aircon's Mode, Fan,
 * Fresh Air and Timer (ClimateKnobs.tsx). The portrait slot is sized for this
 * knob, titled, so every dial gets the same slot and a line of them spreads
 * evenly.
 */
export const QUICK_WIDEST_RINGS = 4;

/** Portrait, the same test the card's portrait CSS keys on. */
export const PORTRAIT_QUERY = "(aspect-ratio <= 1)";

/** Width the widest knob's rings reach at `size` — the portrait slot width. */
export function quickDialSlot(size: number) {
  return ringGeometry(size, QUICK_WIDEST_RINGS, true).footprint;
}

/**
 * The largest dial size, from the usual 133px down to the temperature knob's
 * 100px floor, whose rings still fit `width`. Below the floor the dials stay at
 * 100px rather than stop reading as knobs (Adeline, 2026-09-14).
 */
export function quickDialSizeFor(width: number) {
  for (let size = QUICK_TEMPERATURE_SIZE; size > TEMPERATURE_ENCODER_MIN_SIZE; size -= 1) {
    if (quickDialSlot(size) <= width) return size;
  }
  return TEMPERATURE_ENCODER_MIN_SIZE;
}
