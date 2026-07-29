import { afterEach, describe, expect, it } from "vitest";

import { applyDeviceTheme, DEFAULT_THEME, type DeviceTheme } from "./accentColor";

// Regression guard for a defect that shipped once: the reminder icon bar's
// overdue pulse is driven by --nova-alert-rgb, seeded from the theme's avatar
// `gradientAlert` slot. That slot's intensity means "how hard to tint the ORB",
// and the shipped dark theme sets it to 0 — so scaling the colour by it
// produced rgb(0 0 0) and the pulse glowed black, i.e. did nothing at all, on
// a default install.

function themeWithAlert(
  rgb: [number, number, number],
  intensity: number,
): DeviceTheme {
  return {
    ...DEFAULT_THEME,
    avatar: {
      ...DEFAULT_THEME.avatar,
      gradientAlert: { cursor: { x: 0, y: 0 }, intensity, rgb },
    },
  };
}

function alertRgb() {
  return document.documentElement.style.getPropertyValue("--nova-alert-rgb").trim();
}

afterEach(() => {
  document.documentElement.style.removeProperty("--nova-alert-rgb");
});

describe("--nova-alert-rgb", () => {
  it("uses the intensity-applied colour when that renders to something", () => {
    applyDeviceTheme(themeWithAlert([200, 100, 50], 100));
    expect(alertRgb()).toBe("200 100 50");
  });

  it("falls back to the chosen hue when the orb tint is turned off", () => {
    // The exact case on the live dark theme: intensity 0, hue still amber.
    applyDeviceTheme(themeWithAlert([250, 168, 15], 0));
    expect(alertRgb()).toBe("250 168 15");
  });

  it("never resolves to black, which would be an invisible pulse", () => {
    for (const [rgb, intensity] of [
      [[250, 168, 15], 0],
      [[0, 0, 0], 100],
      [[0, 0, 0], 0],
      [[2, 1, 3], 1],
    ] as const) {
      applyDeviceTheme(themeWithAlert([...rgb] as [number, number, number], intensity));
      const channels = alertRgb().split(" ").map(Number);
      expect(channels.some((channel) => channel > 8), `rgb=${rgb} intensity=${intensity}`).toBe(true);
    }
  });

  it("honours a deliberate colour choice at partial intensity", () => {
    applyDeviceTheme(themeWithAlert([0, 255, 64], 50));
    expect(alertRgb()).toBe("0 128 32");
  });
});
