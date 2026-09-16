"use client";

import type { NovaAvatarTheme } from "../theme-model/types";

export type AvatarSlot =
  | "gradientAlert"
  | "gradientCenter"
  | "gradientOuter"
  | "gymNumber"
  | "voiceGlow"
  | "line0"
  | "line1"
  | "line2";

export type AvatarSlotChoice = { slot: AvatarSlot; label: string; detail: string };

// The numeric "Liquid glass" sliders, in display order. `enabled` is handled
// separately as the group's master switch.
export type GlassSliderKey =
  | "displace"
  | "localStretch"
  | "refractPower"
  | "smoothness"
  | "imageBlur"
  | "refractionOpacity"
  | "clarity"
  | "gloss"
  | "reflection"
  | "drift"
  | "shadow";

export type NovaAvatarConfigProps = {
  embedded?: boolean;
  initialTheme?: Partial<NovaAvatarTheme> | null;
  onThemeChange?: (theme: NovaAvatarTheme) => void;
  onThemePreview?: (theme: NovaAvatarTheme) => void;
  theme?: Partial<NovaAvatarTheme> | null;
};

export type NovaAvatarConfigViewProps = {
  embedded: boolean;
  onThemeChange?: (theme: NovaAvatarTheme) => void;
  onThemePreview?: (theme: NovaAvatarTheme) => void;
  theme: NovaAvatarTheme;
};
