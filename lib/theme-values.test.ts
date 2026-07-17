import { describe, expect, it } from "vitest";
import { themeResponseValue } from "./theme-values";

const avatarFallback = {
  gradientAlert: { cursor: { x: 0.5, y: 0 }, intensity: 100, rgb: [36, 179, 245] },
  gradientCenter: { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [255, 0, 0] },
  gradientOuter: { cursor: { x: 0.51, y: 0 }, intensity: 29, rgb: [0, 242, 255] },
  gymAlertThresholdHours: 168,
  gymNumberColor: { cursor: { x: 0.95, y: 0 }, intensity: 100, rgb: [255, 0, 81] },
  gymNumberOpacity: 100,
  lineColors: [
    { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [255, 0, 0] },
    { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [255, 0, 0] },
    { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [255, 0, 0] },
  ],
  lineOpacities: [17, 19, 19],
};

describe("theme values", () => {
  it("seeds the legacy global avatar only when a variant has no avatar at all", () => {
    const theme = themeResponseValue({
      selection: "dark",
      themes: {
        // No avatar object: a pre-per-variant theme — seed it from the global.
        dark: { accent: { intensity: 20, rgb: [255, 255, 255] } },
        // A present avatar is authoritative and is NOT merged with the global,
        // so it never inherits another theme's gym/gradient/line colours; the
        // client normaliser fills the remaining fields with per-field defaults.
        light: { avatar: { gradientCenter: { intensity: 50, rgb: [1, 2, 3] } } },
      },
    }, avatarFallback);

    expect(theme?.themes.dark.avatar).toEqual(avatarFallback);
    expect(theme?.themes.light.avatar).toEqual({
      gradientCenter: { intensity: 50, rgb: [1, 2, 3] },
    });
  });

  it("preserves intentional zero-intensity gym counter colors", () => {
    const theme = themeResponseValue({
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
    }, avatarFallback);

    const themes = theme?.themes as Record<"dark" | "light", { avatar: Record<string, unknown> }>;
    expect(themes.dark.avatar.gymNumberColor).toEqual({ cursor: { x: 0.169, y: 0 }, intensity: 0, rgb: [251, 255, 0] });
    expect(themes.dark.avatar.gymNumberOpacity).toBe(39);
    expect(themes.light.avatar.gymNumberColor).toEqual({ cursor: { x: 0.2, y: 0.2 }, intensity: 0, rgb: [12, 13, 14] });
    expect(themes.light.avatar.gymNumberOpacity).toBe(40);
  });
});
