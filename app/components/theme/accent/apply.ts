"use client";

// applyDeviceTheme: writes a normalised theme onto :root. The accent CSS
// variable is --cyber-line (see apply-surfaces.ts).
import { setActiveControlSound } from "../../dashboard/controlSound";
import { themeFontStack } from "../../themeFonts";
import {
  applyCssMap,
  applyCssMapBuildingOpacity,
  applyCssMapLabelSize,
  applyCssMapWater,
  applyCssRadarOpacity,
  applyCssTaskGlowIntensity,
} from "./apply-map";
import {
  applyCssBackground,
  applyCssBorder,
  applyCssColor,
  applyCssHeaderFade,
  applyCssPanel,
  applyCssVoiceTranscript,
} from "./apply-surfaces";
import { appliedThemeRgb, normalizeColor, rgbCss, titleColorFor, titleColorSlotFor } from "./color-model";
import { DEFAULT_THEME } from "./defaults";
import { themeFontSizeScale } from "./font-scale";
import { normalizeTheme } from "./theme-model";
import type { DeviceTheme, ThemeColorValue, ThemeFontSetting, ThemeTitleColors, ThemeTitleTone } from "./types";

function applyCssTitleColors(colors: ThemeTitleColors) {
  const root = document.documentElement;
  const dark = appliedThemeRgb(colors.dark);
  const light = appliedThemeRgb(colors.light);

  root.style.setProperty("--cyber-title-dark", rgbCss(dark));
  root.style.setProperty("--cyber-title-light", rgbCss(light));
}

function applyCssTitleTone(
  tone: ThemeTitleTone,
  accent: [number, number, number],
  highlight: [number, number, number],
  background: [number, number, number],
  clockColor: ThemeColorValue,
  titleColors: ThemeTitleColors,
) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-title-on-line", titleColorFor(tone, accent, false));
  root.style.setProperty("--cyber-title-on-cyan", titleColorFor(tone, highlight, false));
  root.style.setProperty("--cyber-title-on-highlight", titleColorFor(tone, highlight, false));
  const clockTextFill = titleColorFor(tone, background, true);
  root.style.setProperty("--cyber-title-on-bg", clockTextFill);
  root.style.setProperty("--cyber-clock-text-fill", clockTextFill);
  root.style.setProperty("--cyber-clock-color", rgbCss(appliedThemeRgb(clockColor)));

  const titleColorSlot = titleColorSlotFor(tone, background, true);
  const clockFill = appliedThemeRgb(titleColors[titleColorSlot]);
  root.style.setProperty("--cyber-title-on-clock-fill", titleColorFor("auto", clockFill, false));
}

// Expose the alert colour to CSS.
//
// The avatar theme is a JS/canvas palette (orbModules reads gradientAlert
// straight off the theme object), so nothing in a stylesheet could reach it.
// The reminder icon bar's overdue pulse shouts in the same colour, so it is
// published as a custom property here, the same way NovaAvatar publishes
// --nova-avatar-voice-glow. Space-separated channels so the value works
// inside rgb(... / alpha).
//
// Intensity is deliberately NOT applied the way the orb applies it. On the orb
// slot, intensity 0 means "do not tint the orb" — a perfectly reasonable thing
// to want, and the shipped dark theme ships exactly that. Scaling by it here
// would multiply the colour to black and turn the overdue pulse into an
// invisible glow: the feature would silently do nothing on a default install.
// So take the intensity-applied colour when it renders to something, and fall
// back to the slot's chosen HUE otherwise. The user's colour choice is still
// honoured; only "how hard to tint the orb" is ignored, because that question
// is not being asked here.
// Last-resort overdue colour: amber, matching the shipped gradientAlert hue.
const DEFAULT_ALERT_RGB: [number, number, number] = [250, 168, 15];

/**
 * The lit LED colour every RotaryEncoder-derived knob reads, published both as
 * a ready-made rgb() and as raw channels, because the glow shadows need an
 * alpha of their own (specs/color-encoder.md, "The LED colour").
 */
function applyCssLedColor(value: ThemeColorValue) {
  const rgb = appliedThemeRgb(normalizeColor(value, DEFAULT_THEME.ledColor));
  const channels = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;
  root.style.setProperty("--nova-led-rgb", channels);
  root.style.setProperty("--nova-led-color", `rgb(${channels})`);
}

function applyCssAlertColor(value: ThemeColorValue) {
  const applied = appliedThemeRgb(value);
  const hue = normalizeColor(value, DEFAULT_THEME.accent).rgb;
  const visible = (rgb: readonly number[]) => rgb.some((channel) => channel > 8);

  const [r, g, b] = visible(applied)
    ? applied
    : visible(hue)
      ? hue
      : DEFAULT_ALERT_RGB;

  document.documentElement.style.setProperty("--nova-alert-rgb", `${r} ${g} ${b}`);
}

// Seed the family/weight/size-scale CSS vars for one font slot. The element rules in
// globals.css read --cyber-<slot>, --cyber-<slot>-weight and --cyber-<slot>-scale.
function applyThemeFontVars(slot: "display" | "clock" | "gym" | "transcript", setting: ThemeFontSetting) {
  const style = document.documentElement.style;
  style.setProperty(`--cyber-${slot}`, themeFontStack(setting.id));
  style.setProperty(`--cyber-${slot}-weight`, String(setting.weight));
  style.setProperty(`--cyber-${slot}-scale`, String(themeFontSizeScale(setting.sizeOffset)));
}

export function applyDeviceTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  const accent = appliedThemeRgb(normalized.accent);
  const highlight = appliedThemeRgb(normalized.highlight);
  const background = appliedThemeRgb(normalized.background);

  applyCssColor("line", accent);
  applyCssColor("cyan", highlight);
  applyCssBorder(normalized.border);
  applyCssHeaderFade(normalized.headerFade);
  applyCssBackground(background);
  applyCssPanel(normalized.panel);
  applyCssTitleColors(normalized.titleColors);
  applyCssTitleTone(normalized.titleTone, accent, highlight, background, normalized.clockColor, normalized.titleColors);
  applyCssVoiceTranscript(normalized.voiceTranscriptColors);
  applyCssMap(normalized.map);
  applyCssMapBuildingOpacity(normalized.mapBuildingOpacity);
  applyCssMapLabelSize(normalized.mapLabelSize);
  applyCssMapWater(normalized.mapWater);
  applyCssRadarOpacity(normalized.radarOpacity);
  applyCssTaskGlowIntensity(normalized.taskGlowIntensity);
  applyCssAlertColor(normalized.avatar.gradientAlert);
  applyCssLedColor(normalized.ledColor);
  setActiveControlSound(normalized.controlSound, normalized.uxSounds);
  applyThemeFontVars("display", normalized.font);
  applyThemeFontVars("clock", normalized.clockFont);
  applyThemeFontVars("gym", normalized.gymFont);
  applyThemeFontVars("transcript", normalized.transcriptFont);
  document.documentElement.style.setProperty("--cyber-map-radar-mode", normalized.radarPaletteMode);
  document.documentElement.style.setProperty("--cyber-map-satellite", normalized.mapSatellite ? "1" : "0");
  document.documentElement.dataset.lightingTint = normalized.lightingTint ? "on" : "off";
  // Every RotaryEncoder-derived knob reads this as its default skin, so the
  // setting reaches the temperature knobs and any future dial without each
  // caller threading a knobSkin prop down to it (specs/color-encoder.md).
  document.documentElement.dataset.knobSkin = normalized.knobSkin;
  document.documentElement.style.setProperty("--nova-lighting-tint-strength", String(normalized.lightingTintStrength));
}
