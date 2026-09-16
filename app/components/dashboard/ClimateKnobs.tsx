"use client";

/**
 * The climate knobs: `TemperatureEncoder` wired to the shared command hooks
 * (specs/temperature-encoder.md).
 *
 * Both the full climate cards and the Quick Access segments mount these, so the
 * knob's bindings — which ring does what, what a mode light means, and what
 * happens in Off — exist once. The commands themselves stay in
 * `climateCommands.ts`; nothing here talks to Home Assistant directly.
 */
export { AirconKnob } from "./climate/AirconKnob";
export { HeaterKnob } from "./climate/HeaterKnob";
