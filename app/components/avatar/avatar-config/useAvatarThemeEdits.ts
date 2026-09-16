"use client";

import { useCallback } from "react";
import { resolveOrbModuleSettings } from "../../../../lib/orb-modules";
import { type ThemeColorValue } from "../../accentColor";
import { normalizeNovaAvatarTheme } from "../theme-model/theme-model";
import type { NovaAvatarTheme } from "../theme-model/types";
import { useOrbModule } from "../../orbModules";
import { lineIndexForSlot } from "./slot-model";
import type { AvatarSlot, GlassSliderKey, NovaAvatarConfigViewProps } from "./types";

/** The config view's theme writers: each returns the next theme for one edit. */
export function useAvatarThemeEdits({
  onThemeChange,
  onThemePreview,
  theme,
}: Omit<NovaAvatarConfigViewProps, "embedded">) {
  const setTheme = useCallback((next: NovaAvatarTheme) => {
    const normalized = normalizeNovaAvatarTheme(next);
    onThemeChange?.(normalized);
  }, [onThemeChange]);
  const previewTheme = useCallback((next: NovaAvatarTheme) => {
    onThemePreview?.(normalizeNovaAvatarTheme(next));
  }, [onThemePreview]);

  // The active module's declared sliders ("Module options"). Values come from
  // the theme's per-module overrides with declared defaults filled in, so the
  // sliders always sit somewhere meaningful.
  const activeModule = useOrbModule(theme.orbModule);
  const moduleSettingValues = resolveOrbModuleSettings(
    activeModule,
    theme.orbModuleSettings[activeModule.id],
  );
  const moduleSettingTheme = useCallback(
    (settingId: string, value: number) => {
      return {
        ...theme,
        orbModuleSettings: {
          ...theme.orbModuleSettings,
          [activeModule.id]: {
            ...theme.orbModuleSettings[activeModule.id],
            [settingId]: value,
          },
        },
      };
    },
    [activeModule.id, theme],
  );

  // "Liquid glass" overlay knobs live on the theme (they apply over any orb
  // module), so they update the theme's `glass` block directly.
  const glassNumberTheme = useCallback(
    (key: GlassSliderKey, value: number) => ({
      ...theme,
      glass: { ...theme.glass, [key]: value },
    }),
    [theme],
  );

  const slotTheme = useCallback(
    (slot: AvatarSlot, value: ThemeColorValue) => {
      if (slot === "gradientCenter") {
        return { ...theme, gradientCenter: value };
      }
      if (slot === "gradientOuter") {
        return { ...theme, gradientOuter: value };
      }
      if (slot === "gradientAlert") {
        return { ...theme, gradientAlert: value };
      }
      if (slot === "gymNumber") {
        return { ...theme, gymNumberColor: value };
      }
      if (slot === "voiceGlow") {
        return { ...theme, voiceGlowColor: value };
      }

      const index = slot === "line0" ? 0 : slot === "line1" ? 1 : 2;
      const nextLines: NovaAvatarTheme["lineColors"] = [
        theme.lineColors[0],
        theme.lineColors[1],
        theme.lineColors[2],
      ];
      nextLines[index] = value;
      return { ...theme, lineColors: nextLines };
    },
    [theme],
  );

  const opacityTheme = useCallback(
    (slot: AvatarSlot, opacity: number) => {
      if (slot === "gymNumber") {
        return { ...theme, gymNumberOpacity: opacity };
      }

      const index = lineIndexForSlot(slot);
      if (index === null) return theme;

      const nextOpacities: NovaAvatarTheme["lineOpacities"] = [
        theme.lineOpacities[0],
        theme.lineOpacities[1],
        theme.lineOpacities[2],
      ];
      nextOpacities[index] = opacity;
      return { ...theme, lineOpacities: nextOpacities };
    },
    [theme],
  );
  // A slot with its own opacity carries it on the colour dial's fourth light
  // (specs/color-encoder.md), so one gesture can write both fields.
  const colorAndOpacityTheme = useCallback(
    (slot: AvatarSlot, value: ThemeColorValue, opacity: number | null) => {
      const withColor = slotTheme(slot, value);
      if (opacity === null) return withColor;
      const withOpacity = opacityTheme(slot, opacity);
      return {
        ...withColor,
        gymNumberOpacity: withOpacity.gymNumberOpacity,
        lineOpacities: withOpacity.lineOpacities,
      };
    },
    [opacityTheme, slotTheme],
  );
  return {
    setTheme,
    previewTheme,
    activeModule,
    moduleSettingValues,
    moduleSettingTheme,
    glassNumberTheme,
    colorAndOpacityTheme,
  };
}
