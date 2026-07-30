import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_SET, normalizeThemeSet } from "../accentColor";
import {
  resolveHousePartyTargetTheme,
  type RuntimeThemeState,
} from "./useHousePartyThemeFollow";

const themeSet = normalizeThemeSet(DEFAULT_THEME_SET);
const library = {
  activeId: null,
  entries: [{
    id: "visualiser-theme",
    name: "Visualiser",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    themeSet,
  }],
};

function runtime(overrides: Partial<RuntimeThemeState> = {}): RuntimeThemeState {
  return {
    active: true,
    followVisualizerWhenActive: true,
    theme: {
      themeId: "visualiser-theme",
      variant: "light",
      transitionSeconds: 3,
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("House Party dashboard theme target", () => {
  it("resolves the exact theme and light/dark variant reported by the visualiser", () => {
    expect(resolveHousePartyTargetTheme(runtime(), library)).toBe(themeSet.themes.light);
    expect(resolveHousePartyTargetTheme(runtime({
      theme: { ...runtime().theme!, variant: "dark" },
    }), library)).toBe(themeSet.themes.dark);
  });

  it("does not override before House Party starts or when shared follow is off", () => {
    expect(resolveHousePartyTargetTheme(runtime({ active: false }), library)).toBeNull();
    expect(resolveHousePartyTargetTheme(runtime({ followVisualizerWhenActive: false }), library)).toBeNull();
  });
});
