"use client";

// CSS-variable application for the accent, highlight, border, header fade,
// background, panel and voice-transcript slots.
import { appliedThemeRgb, clamp, normalizeColor, rgbCss } from "./color-model";
import { PANEL_SEED_INTENSITY_RATIO } from "./constants";
import { DEFAULT_THEME } from "./defaults";
import type { ThemeBorderValue, ThemeHeaderFadeValue, ThemePanelValue, ThemeVoiceTranscriptColors } from "./types";

export function applyCssColor(name: "line" | "cyan", rgb: [number, number, number]) {
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  if (name === "line") {
    root.style.setProperty("--foreground", `rgb(${value})`);
    root.style.setProperty("--cyber-line", `rgb(${value})`);
    root.style.setProperty("--cyber-line-rgb", value);
    root.style.setProperty("--cyber-line-dim", `rgb(${value} / 0.36)`);
    return;
  }

  root.style.setProperty("--cyber-cyan", `rgb(${value})`);
  root.style.setProperty("--cyber-cyan-rgb", value);
  root.style.setProperty("--cyber-highlight", `rgb(${value})`);
  root.style.setProperty("--cyber-highlight-rgb", value);
}

/**
 * The header fade strip's colour, as one ready-made rgb() the gradients use.
 * The theme's opacity is the alpha here, never the element's `opacity` — that
 * belongs to the scroll, and the two would otherwise fight over one property
 * (specs/header-fade.md).
 */
export function applyCssHeaderFade(headerFade: ThemeHeaderFadeValue) {
  const rgb = appliedThemeRgb(normalizeColor(headerFade.color, DEFAULT_THEME.headerFade.color));
  const alpha = clamp(Math.round(Number(headerFade.opacity ?? DEFAULT_THEME.headerFade.opacity)), 0, 100) / 100;
  const root = document.documentElement;
  root.style.setProperty("--cyber-header-fade-rgb", `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
  root.style.setProperty("--cyber-header-fade", `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`);
}

export function applyCssBorder(border: ThemeBorderValue) {
  const normalizedBorder = {
    color: normalizeColor(border.color, DEFAULT_THEME.border.color),
    opacity: clamp(Math.round(Number(border.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
  };
  const rgb = appliedThemeRgb(normalizedBorder.color);
  const opacity = normalizedBorder.opacity / 100;
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  root.style.setProperty("--cyber-border-rgb", value);
  root.style.setProperty("--cyber-border-dim", `rgb(${value} / ${opacity})`);
  root.style.setProperty("--cyber-border-strong", `rgb(${value} / ${Math.min(1, opacity + 0.54)})`);
}

export function applyCssBackground(rgb: [number, number, number]) {
  const root = document.documentElement;
  root.style.setProperty("--background", rgbCss(rgb));
  root.style.setProperty("--cyber-bg", rgbCss(rgb));
}

export function applyCssPanel(panel: ThemePanelValue) {
  const rgb = appliedThemeRgb(panel.color);
  const alpha = clamp(Math.round(Number(panel.opacity ?? 100)), 0, 100) / 100;
  // Soft was background + 7% white; expressed from the panel colour it is this
  // lift, which matches the old tone exactly at the seeded default.
  const soft = rgb.map((part) =>
    clamp(Math.round(part * (0.93 / PANEL_SEED_INTENSITY_RATIO) + 255 * 0.07), 0, 255),
  ) as [number, number, number];
  const root = document.documentElement;
  root.style.setProperty("--cyber-panel-rgb", `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
  root.style.setProperty("--cyber-panel", `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})`);
  root.style.setProperty("--cyber-panel-soft", `rgb(${soft[0]} ${soft[1]} ${soft[2]} / ${alpha})`);
}

export function applyCssVoiceTranscript(colors: ThemeVoiceTranscriptColors) {
  const root = document.documentElement;
  const background = appliedThemeRgb(colors.background);
  const text = appliedThemeRgb(colors.text);
  root.style.setProperty("--cyber-voice-transcript-bg", rgbCss(background));
  root.style.setProperty("--cyber-voice-transcript-text", rgbCss(text));
  root.style.setProperty("--cyber-voice-transcript-text-rgb", `${text[0]} ${text[1]} ${text[2]}`);
  // The scanline tint uses the raw selected hue (not intensity-scaled) so the
  // texture stays visible over a very dark applied background.
  const tint = colors.background.rgb;
  root.style.setProperty("--cyber-voice-transcript-scanline-rgb", `${tint[0]} ${tint[1]} ${tint[2]}`);
  root.style.setProperty("--cyber-voice-transcript-scanline-opacity", (colors.scanlineOpacity / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-scanline-scale", (colors.scanlineScale / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-glow-alpha", (colors.glowIntensity / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-glow-size", `${colors.glowSize}px`);
}
