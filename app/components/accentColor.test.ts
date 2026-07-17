import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeThemeSet,
  useDeviceTheme,
  type ThemeStorageValue,
} from "./accentColor";

function themeWithGymColor(rgb: [number, number, number]): ThemeStorageValue {
  return {
    selection: "dark",
    themes: {
      dark: {
        avatar: {
          gymNumberColor: { cursor: { x: 0.25, y: 0 }, intensity: 0, rgb },
          gymNumberOpacity: 77,
        },
      },
      light: {
        avatar: {
          gymNumberColor: { cursor: { x: 0.75, y: 0 }, intensity: 0, rgb: [1, 2, 3] },
          gymNumberOpacity: 44,
        },
      },
    },
  } as unknown as ThemeStorageValue;
}

function DeviceThemeProbe({ testId = "gym-color" }: { testId?: string }) {
  const { theme, themeReady } = useDeviceTheme();

  useEffect(() => {
    document.body.dataset.themeReady = themeReady ? "true" : "false";
  }, [themeReady]);

  return (
    createElement("div", {
      "data-testid": testId,
      "data-color": theme.avatar.gymNumberColor.rgb.join(","),
      "data-opacity": theme.avatar.gymNumberOpacity,
    })
  );
}

function ThemeVariantWriter({ rgb }: { rgb: [number, number, number] }) {
  const { setThemeVariant, themeSet } = useDeviceTheme();

  return createElement("button", {
    type: "button",
    onClick: () => {
      const darkTheme = themeSet.themes.dark;
      setThemeVariant("dark", {
        ...darkTheme,
        avatar: {
          ...darkTheme.avatar,
          gymNumberColor: { cursor: { x: 0.42, y: 0 }, intensity: 100, rgb },
          gymNumberOpacity: 100,
        },
      });
    },
  }, "update dark variant");
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.dataset.themeReady = "false";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("accentColor theme normalization", () => {
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

  it("updates another mounted shared-theme consumer immediately after setThemeVariant", async () => {
    let sharedTheme = themeWithGymColor([10, 20, 30]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/theme") {
        throw new Error(`unexpected fetch: ${String(input)}`);
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { theme?: ThemeStorageValue | null };
        sharedTheme = body.theme ?? sharedTheme;
        return jsonResponse({ theme: sharedTheme });
      }
      return jsonResponse({ theme: sharedTheme });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(createElement("div", null, [
      createElement(ThemeVariantWriter, { key: "writer", rgb: [255, 0, 93] }),
      createElement(DeviceThemeProbe, { key: "reader", testId: "reader-gym-color" }),
    ]));

    await waitFor(() => {
      expect(screen.getByTestId("reader-gym-color")).toHaveAttribute("data-color", "10,20,30");
      expect(screen.getByTestId("reader-gym-color")).toHaveAttribute("data-opacity", "77");
      expect(document.body.dataset.themeReady).toBe("true");
    });

    const getCallsBeforeUpdate = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === "/api/theme" && init?.method !== "POST").length;
    fireEvent.click(screen.getByRole("button", { name: "update dark variant" }));

    await waitFor(() => {
      expect(screen.getByTestId("reader-gym-color")).toHaveAttribute("data-color", "255,0,93");
      expect(screen.getByTestId("reader-gym-color")).toHaveAttribute("data-opacity", "100");
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === "/api/theme" && init?.method !== "POST").length).toBe(getCallsBeforeUpdate);

    await new Promise((resolve) => window.setTimeout(resolve, 300));
  });
});
