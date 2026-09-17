import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDeviceTheme,
  normalizeThemeSet,
  mixDeviceThemeColors,
  type ThemeStorageValue,
} from "../../accentColor";

beforeEach(() => {
  window.localStorage.clear();
  document.body.dataset.themeReady = "false";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("accentColor theme normalization", () => {
  it("interpolates only colours for a House Party override", () => {
    const configured = normalizeThemeSet(null).themes.dark;
    const target = structuredClone(normalizeThemeSet(null).themes.light);
    target.accent = { ...target.accent, intensity: 100, rgb: [255, 0, 0] };
    target.font = { ...target.font, id: "rajdhani", sizeOffset: 80 };
    target.backgroundEffect = { ...target.backgroundEffect, warpAmplitude: 220 };
    target.avatar = { ...target.avatar, orbModule: "halo" };

    const mixed = mixDeviceThemeColors(configured, target, 1);
    expect(mixed.accent).toEqual(target.accent);
    expect(mixed.font).toEqual(configured.font);
    expect(mixed.backgroundEffect).toEqual(configured.backgroundEffect);
    expect(mixed.avatar.orbModule).toBe(configured.avatar.orbModule);
  });

  it("preserves intentional zero-intensity status-orb gym counter colors from cached theme sets", () => {
    // Partial avatars on purpose: this exercises the runtime normalisation of
    // a cached theme that stored only the gym counter fields.
    const themeSet = normalizeThemeSet({
      selection: "dark",
      themes: {
        dark: {
          avatar: {
            gymNumberColor: { cursor: { x: 0.169, y: 0 }, intensity: 0, rgb: [251, 255, 0] },
            gymNumberOpacity: 39,
          },
        },
        light: {
          avatar: {
            gymNumberColor: { cursor: { x: 0.2, y: 0.2 }, intensity: 0, rgb: [12, 13, 14] },
            gymNumberOpacity: 40,
          },
        },
      },
    } as unknown as ThemeStorageValue);

    expect(themeSet.themes.dark.avatar.gymNumberColor).toEqual({
      cursor: { x: 0.169, y: 0 },
      intensity: 0,
      rgb: [251, 255, 0],
    });
    expect(themeSet.themes.dark.avatar.gymNumberOpacity).toBe(39);
    expect(themeSet.themes.light.avatar.gymNumberColor).toEqual({
      cursor: { x: 0.2, y: 0.2 },
      intensity: 0,
      rgb: [12, 13, 14],
    });
    expect(themeSet.themes.light.avatar.gymNumberOpacity).toBe(40);
  });

  it("defaults the knob LED colour to white and keeps a stored one per variant", () => {
    // White by default so no saved theme changes appearance until Adeline picks
    // a colour (2026-09-12).
    const defaults = normalizeThemeSet(null).themes;
    expect(defaults.dark.ledColor).toEqual({ cursor: { x: 0, y: 1 }, intensity: 100, rgb: [255, 255, 255] });
    expect(defaults.light.ledColor).toEqual({ cursor: { x: 0, y: 1 }, intensity: 100, rgb: [255, 255, 255] });

    const themeSet = normalizeThemeSet({
      selection: "dark",
      themes: {
        dark: { ledColor: { cursor: { x: 0.3, y: 0.4 }, intensity: 80, rgb: [255, 0, 128] } },
        light: { ledColor: { rgb: [0, 128, 255] } },
      },
    } as unknown as ThemeStorageValue);

    expect(themeSet.themes.dark.ledColor).toEqual({ cursor: { x: 0.3, y: 0.4 }, intensity: 80, rgb: [255, 0, 128] });
    // A partial stored colour falls back to the default for the missing fields.
    expect(themeSet.themes.light.ledColor).toEqual({ cursor: { x: 0, y: 1 }, intensity: 100, rgb: [0, 128, 255] });
  });

  it("seeds the panel slot from the background so older themes keep their look", () => {
    // specs/panel-surface.md, "Default": 0.84 intensity == old 16% mix to black.
    const themeSet = normalizeThemeSet({
      selection: "dark",
      themes: {
        dark: { background: { cursor: { x: 0.2, y: 0.3 }, intensity: 50, rgb: [200, 100, 40] } },
        light: {
          background: { cursor: { x: 0.2, y: 0.3 }, intensity: 50, rgb: [200, 100, 40] },
          panel: { color: { cursor: { x: 0.9, y: 0.1 }, intensity: 70, rgb: [10, 20, 30] }, opacity: 42 },
        },
      },
    } as unknown as ThemeStorageValue);

    expect(themeSet.themes.dark.panel).toEqual({
      color: { cursor: { x: 0.2, y: 0.3 }, intensity: 42, rgb: [200, 100, 40] },
      opacity: 100,
    });
    expect(themeSet.themes.light.panel).toEqual({
      color: { cursor: { x: 0.9, y: 0.1 }, intensity: 70, rgb: [10, 20, 30] },
      opacity: 42,
    });
  });

  it("paints panels with true alpha and derives the soft tone from the panel colour", () => {
    const theme = normalizeThemeSet(null).themes.dark;
    applyDeviceTheme({
      ...theme,
      panel: { color: { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [84, 42, 0] }, opacity: 60 },
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--cyber-panel")).toBe("rgb(84 42 0 / 0.6)");
    // 84 * 0.93/0.84 + 17.85 = 110.85; 42 -> 64.35; 0 -> 17.85
    expect(style.getPropertyValue("--cyber-panel-soft")).toBe("rgb(111 64 18 / 0.6)");
    expect(style.getPropertyValue("--cyber-panel-rgb")).toBe("84 42 0");
  });

  it("keeps the configured panel opacity when theme colours are mixed", () => {
    const { dark, light } = normalizeThemeSet(null).themes;
    const configured = { ...dark, panel: { ...dark.panel, opacity: 30 } };
    const target = { ...light, panel: { ...light.panel, opacity: 90 } };
    expect(mixDeviceThemeColors(configured, target, 0.5).panel.opacity).toBe(30);
  });

  it("keeps voice transcript colours independent for dark and light themes", () => {
    const themeSet = normalizeThemeSet({
      selection: "dark",
      themes: {
        dark: {
          voiceTranscriptColors: {
            background: { cursor: { x: 0.1, y: 0.2 }, intensity: 80, rgb: [10, 20, 30] },
          },
        },
        light: {
          voiceTranscriptColors: {
            background: { cursor: { x: 0.7, y: 0.8 }, intensity: 90, rgb: [40, 50, 60] },
          },
        },
      },
    } as unknown as ThemeStorageValue);

    expect(themeSet.themes.dark.voiceTranscriptColors.background.rgb).toEqual([10, 20, 30]);
    expect(themeSet.themes.light.voiceTranscriptColors.background.rgb).toEqual([40, 50, 60]);
  });

});
