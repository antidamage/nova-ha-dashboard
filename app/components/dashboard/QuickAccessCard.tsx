"use client";

/**
 * Quick Access — one line of the controls used most: whole-home light colour,
 * the lounge and bedroom climate at their simplest, and the outside weather.
 * See specs/quick-access-card.md.
 *
 * Everything here is props-driven so another surface can mount the card, or
 * any one segment of it. Commands go through the same hooks and zone actions
 * the full cards use; nothing in this file decides device behaviour.
 */
//
// Facade. The body lives in ./quick-access/:
//   dial-model.ts            dial sizes and the portrait slot maths
//   useQuickDialSize.ts      portrait dial shrinking
//   QuickSegment.tsx         shared tile parts (segment, climate wrapper, title, button)
//   QuickLightsSegment.tsx   Home zone colour dial and rule presets
//   QuickClimateSegments.tsx aircon and heater knobs
//   QuickWeatherSegment.tsx  outside weather and its icon table
//   QuickAccessCard.tsx      the card itself
// Climate knobs share one command-hook instance per room through
// ClimateCommandsProvider (specs/quick-access-card.md); nothing here creates one.
export { quickDialSizeFor, quickDialSlot } from "./quick-access/dial-model";
export { QuickLightsSegment } from "./quick-access/QuickLightsSegment";
export { QuickAirconSegment, QuickHeaterSegment } from "./quick-access/QuickClimateSegments";
export { QuickWeatherSegment, weatherIcon } from "./quick-access/QuickWeatherSegment";
export { QuickAccessCard } from "./quick-access/QuickAccessCard";
export type { QuickAccessCardProps } from "./quick-access/QuickAccessCard";
