"use client";

import { type ThemeColorValue } from "../../accentColor";
import { alertPulseScale } from "../theme-model/theme-model";
import type { NovaAvatarTheme } from "../theme-model/types";
import type { AvatarSlot } from "./types";

/**
 * The alert-rate reading. The period itself is the module's, and modules differ
 * (1.0s to 1.6s), so the useful number is what the slider does to it — and the
 * word says which way, because a multiplier alone does not read as a speed.
 */
export function alertPulseRateText(rate: number) {
  const scale = alertPulseScale(rate);
  const word = scale < 0.85 ? "fast" : scale > 1.18 ? "sedate" : "as set";
  return `${scale.toFixed(2)}x ${word}`;
}

export function readSlot(theme: NovaAvatarTheme, slot: AvatarSlot): ThemeColorValue {
  if (slot === "gradientAlert") return theme.gradientAlert;
  if (slot === "gradientCenter") return theme.gradientCenter;
  if (slot === "gradientOuter") return theme.gradientOuter;
  if (slot === "gymNumber") return theme.gymNumberColor;
  if (slot === "voiceGlow") return theme.voiceGlowColor;
  if (slot === "line0") return theme.lineColors[0];
  if (slot === "line1") return theme.lineColors[1];
  return theme.lineColors[2];
}

export function lineIndexForSlot(slot: AvatarSlot) {
  if (slot === "line0") return 0;
  if (slot === "line1") return 1;
  if (slot === "line2") return 2;
  return null;
}

export function opacityForSlot(theme: NovaAvatarTheme, slot: AvatarSlot) {
  if (slot === "gymNumber") return theme.gymNumberOpacity;
  const index = lineIndexForSlot(slot);
  return index === null ? null : theme.lineOpacities[index];
}
