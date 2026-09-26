import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const preferences = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mergeDashboardPreferences = vi.hoisted(() =>
  vi.fn(async (_next: Record<string, unknown>) => undefined),
);

vi.mock("../../dashboard-config", () => ({ readDashboardConfig: vi.fn(async () => config.current) }));
vi.mock("../../preferences", () => ({
  readDashboardPreferences: vi.fn(async () => preferences.current),
  mergeDashboardPreferences,
}));

const { volumeArrivalTarget, clampVolumePct } = await import("./volume");

const storedTheme = {
  selection: "dark",
  themes: {
    dark: { controlSound: { volume: 60 }, font: { id: "mono", weight: 500, sizeOffset: 0 } },
    light: { controlSound: { volume: 60 }, font: { id: "sans", weight: 400, sizeOffset: 0 } },
  },
};

type WrittenTheme = {
  selection: string;
  themes: Record<string, { controlSound: { volume: number }; font: unknown }>;
};

beforeEach(() => {
  mergeDashboardPreferences.mockClear();
  config.current = {
    dashboard: {
      avatar: null,
      arrivals: { climatePresets: [], volumePresets: [{ id: "quiet", label: "Quiet", volumePct: 20 }] },
    },
  };
  preferences.current = { theme: storedTheme };
});

describe("volume arrival target", () => {
  it("lists the configured presets", async () => {
    expect(await volumeArrivalTarget.presets()).toEqual([{ id: "quiet", label: "Quiet" }]);
  });

  it("sets the dashboard sound volume on BOTH theme variants", async () => {
    await volumeArrivalTarget.apply("quiet");

    const written = mergeDashboardPreferences.mock.calls[0][0] as unknown as {
      theme: WrittenTheme;
      themeUpdatedAt: string;
    };
    expect(written.theme.selection).toBe("dark");
    expect(written.theme.themes.dark.controlSound.volume).toBe(20);
    expect(written.theme.themes.light.controlSound.volume).toBe(20);
    // Sibling theme fields survive: this writes one number, not a theme.
    expect(written.theme.themes.light.font).toEqual({ id: "sans", weight: 400, sizeOffset: 0 });
    expect(typeof written.themeUpdatedAt).toBe("string");
  });

  it("refuses a preset that is not configured", async () => {
    await expect(volumeArrivalTarget.apply("nope")).rejects.toThrow("Unknown volume preset: nope");
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });

  it("clamps a value outside the slider's range", () => {
    expect(clampVolumePct(140)).toBe(100);
    expect(clampVolumePct(-5)).toBe(0);
    expect(clampVolumePct(Number.NaN)).toBe(0);
    expect(clampVolumePct(42.6)).toBe(43);
  });
});
