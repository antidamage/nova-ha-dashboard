import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeThemeSet,
  useDeviceTheme,
  type ThemeStorageValue,
} from "./accentColor";
import { SliderControlPanel } from "./ConfigControls";

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

function ThemeFontProbe() {
  const { theme } = useDeviceTheme();
  return createElement("div", { "data-testid": "theme-font", "data-font": theme.font.id });
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

function ThemeFontWriter({ id }: { id: string }) {
  const { setThemeVariant, themeSet } = useDeviceTheme();
  return createElement("button", {
    type: "button",
    onClick: () => setThemeVariant("dark", {
      ...themeSet.themes.dark,
      font: { ...themeSet.themes.dark.font, id },
    }),
  }, "update theme font");
}

function ThemeFontWeightSlider() {
  const { setThemeVariant, themeSet } = useDeviceTheme();
  const theme = themeSet.themes.dark;
  return createElement(SliderControlPanel, {
    ariaLabel: "Theme font weight",
    ariaValueText: String(theme.font.weight),
    color: [1, 2, 3],
    label: "Weight",
    min: 100,
    max: 900,
    step: 100,
    value: theme.font.weight,
    valueText: String(theme.font.weight),
    onPreview: (weight: number) => setThemeVariant("dark", {
      ...theme,
      font: { ...theme.font, weight },
    }, { persist: false }),
    onCommit: (weight: number) => setThemeVariant("dark", {
      ...theme,
      font: { ...theme.font, weight },
    }),
  });
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
  vi.restoreAllMocks();
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

  it("keeps a font choice authoritative and retries when its first shared write fails", async () => {
    let sharedTheme = themeWithGymColor([10, 20, 30]);
    let postAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/theme") {
        throw new Error(`unexpected fetch: ${String(input)}`);
      }
      if (init?.method === "POST") {
        postAttempts += 1;
        if (postAttempts === 1) {
          return { ok: false, status: 503, json: async () => ({ error: "temporary" }) } as Response;
        }
        const body = JSON.parse(String(init.body)) as { theme?: ThemeStorageValue | null };
        sharedTheme = body.theme ?? sharedTheme;
        return jsonResponse({ theme: sharedTheme });
      }
      return jsonResponse({ theme: sharedTheme });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(createElement("div", null, [
      createElement(ThemeFontWriter, { key: "writer", id: "orbitron" }),
      createElement(ThemeFontProbe, { key: "reader" }),
    ]));

    await waitFor(() => expect(screen.getByTestId("theme-font")).toHaveAttribute("data-font", "rajdhani"));
    fireEvent.click(screen.getByRole("button", { name: "update theme font" }));
    expect(screen.getByTestId("theme-font")).toHaveAttribute("data-font", "orbitron");

    await waitFor(() => expect(postAttempts).toBe(2), { timeout: 3000 });
    expect(normalizeThemeSet(sharedTheme).themes.dark.font.id).toBe("orbitron");
    expect(screen.getByTestId("theme-font")).toHaveAttribute("data-font", "orbitron");
  });

  it("does not send a theme slider write until pointer release", async () => {
    let sharedTheme = themeWithGymColor([10, 20, 30]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/theme") {
        throw new Error(`unexpected fetch: ${String(input)}`);
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { theme?: ThemeStorageValue | null };
        sharedTheme = body.theme ?? sharedTheme;
      }
      return jsonResponse({ theme: sharedTheme });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(ThemeFontWeightSlider));

    const slider = await screen.findByRole("slider", { name: "Theme font weight" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 50, height: 50, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const postCount = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 50, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(slider, { buttons: 1, clientX: 150, clientY: 25, pointerId: 1 });
    expect(postCount()).toBe(0);

    fireEvent.pointerUp(slider, { clientX: 150, clientY: 25, pointerId: 1 });
    await waitFor(() => expect(postCount()).toBe(1));
  });
});
