"use client";

// The knob's resolved light/dark treatment for a theme.
//
// `DeviceTheme.knobSkin` is the device-wide setting, and a dial built on
// `RotaryEncoder` may pin its own. Both resolve to one of two treatments, and
// "auto" is the stop that has to look at something to decide — so the rule
// lives here rather than being re-derived wherever a treatment is needed.
//
// The canvas status orb needs this without a DOM element (it has no surface to
// sample), and so does the config UI, so the rule reads the THEME rather than
// the page: a pinned skin is honoured exactly, and "auto" follows the theme's
// own background. That is the same rule the Apple TV's `knobSkinMode` applies
// (DashboardStore.swift), which keeps the orb identical on both platforms.
//
// On the web a DIAL resolves "auto" slightly differently: `useKnobSkin` has an
// element to look at, so with no pinned skin it samples the surface the knob is
// painted on (`isLightSurface`) rather than the theme's background. A pinned
// Light or Dark therefore agrees exactly with the dials either way, while
// "auto" can differ from a dial sitting on a surface that is not the theme
// background. The orb takes the theme's answer deliberately: it renders the
// same module as the Apple TV, which has no DOM to sample, so this is the one
// rule both engines can implement identically.

import { appliedThemeRgb } from "./color-model";
import type { DeviceTheme, KnobSkinMode } from "./types";

/** The two treatments a knob is actually painted in. */
export type ResolvedKnobTreatment = "dark" | "light";

/** Rec. 709 luma, 0-1, of a theme background's applied colour. */
export function themeBackgroundLuminance(theme: DeviceTheme) {
  const [r, g, b] = appliedThemeRgb(theme.background);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Which treatment a knob draws with. A pinned `knobSkin` wins outright — a
 * dark theme may ask for the pale knob, and vice versa — and `"auto"` follows
 * the surface behind the knob, which on a themed page is the theme's own
 * background.
 */
export function resolveKnobTreatment(
  knobSkin: KnobSkinMode | undefined,
  theme: DeviceTheme,
): ResolvedKnobTreatment {
  if (knobSkin === "dark" || knobSkin === "light") return knobSkin;
  return themeBackgroundLuminance(theme) > 0.5 ? "light" : "dark";
}
