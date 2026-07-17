import { describe, expect, it } from "vitest";
import {
  parseDesktopSleepRequest,
  parseDesktopWakeRequest,
  parseEntityActionRequest,
  parseThemeUpdateRequest,
  parseWatchfaceUpdateRequest,
  parseZoneActionRequest,
} from "./dashboard-requests";

describe("dashboard API request parsing", () => {
  it("preserves zone action defaults and coercion", () => {
    expect(parseZoneActionRequest({
      action: "color",
      brightnessPct: "42",
      cursor: { x: -1, y: 2 },
      rgb: ["260", "12.4", "-5"],
      sourceClientId: "9",
    })).toEqual({
      action: "color",
      brightnessPct: 42,
      cursor: { x: 0, y: 1 },
      rgb: [255, 12, 0],
      sourceClientId: 9,
      zoneId: "everything",
    });
  });

  it("keeps existing zone action error wording", () => {
    expect(() => parseZoneActionRequest({ action: "dim" })).toThrow("Unsupported zone action: dim");
  });

  it("parses entity actions with the current string coercion", () => {
    expect(parseEntityActionRequest({
      data: { brightness_pct: 80 },
      domain: "light",
      entityId: 123,
      service: "turn_on",
      sourceClientId: "3",
    })).toEqual({
      data: { brightness_pct: 80 },
      domain: "light",
      entityId: "123",
      remember: undefined,
      service: "turn_on",
      sourceClientId: 3,
    });
  });

  it("requires an explicit desktop sleep target", () => {
    expect(() => parseDesktopSleepRequest({})).toThrow("Desktop target id is required");
    expect(parseDesktopSleepRequest({ id: "studio-desktop", sourceClientId: "4" })).toEqual({
      id: "studio-desktop",
      sourceClientId: 4,
    });
  });

  it("requires an explicit desktop wake target", () => {
    expect(() => parseDesktopWakeRequest({ id: "" })).toThrow("Desktop target id is required");
    expect(parseDesktopWakeRequest({ id: "studio-desktop" })).toEqual({
      id: "studio-desktop",
      sourceClientId: null,
    });
  });

  it("strips local-only theme fields from shared theme updates", () => {
    expect(parseThemeUpdateRequest({
      theme: {
        accent: { mode: "rgb" },
        avatar: { gradientCenter: "old-location" },
        autoFullscreenOnLoad: true,
      },
    })).toEqual({
      theme: {
        accent: { mode: "rgb" },
        avatar: { gradientCenter: "old-location" },
      },
    });
  });

  it("strips local-only theme fields from namespaced theme updates", () => {
    expect(parseThemeUpdateRequest({
      theme: {
        selection: "auto",
        themes: {
          dark: {
            accent: { mode: "dark" },
            avatar: { gradientCenter: "old-location" },
            autoFullscreenOnLoad: true,
          },
          light: {
            accent: { mode: "light" },
            autoFullscreenOnLoad: false,
          },
        },
      },
    })).toEqual({
      theme: {
        selection: "auto",
        themes: {
          dark: {
            accent: { mode: "dark" },
            avatar: { gradientCenter: "old-location" },
          },
          light: {
            accent: { mode: "light" },
          },
        },
      },
    });
  });

  it("normalizes watchface timestamps and rejects empty updates", () => {
    expect(parseWatchfaceUpdateRequest({ gymLastResetAt: "2026-06-02T12:00:00Z" })).toEqual({
      gymAlertThresholdHours: undefined,
      gymLastResetAt: "2026-06-02T12:00:00.000Z",
      idleTimeoutMs: undefined,
    });
    expect(parseWatchfaceUpdateRequest({ gymAlertThresholdHours: 999 })).toEqual({
      gymAlertThresholdHours: 168,
      gymLastResetAt: undefined,
      idleTimeoutMs: undefined,
    });
    expect(() => parseWatchfaceUpdateRequest({})).toThrow("No watchface settings provided");
  });
});
