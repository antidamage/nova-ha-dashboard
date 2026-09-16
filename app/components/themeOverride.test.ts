import { afterEach, describe, expect, it, vi } from "vitest";
import {
  effectiveThemeSelection,
  nextThemeOverride,
  normalizeThemeOverride,
  readThemeOverride,
  resolveThemeVariant,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_STORAGE_KEY,
  writeThemeOverride,
} from "./accentColor";

describe("theme override", () => {
  afterEach(() => window.localStorage.clear());

  it("cycles unset -> auto -> light -> dark -> unset", () => {
    expect(nextThemeOverride("unset")).toBe("auto");
    expect(nextThemeOverride("auto")).toBe("light");
    expect(nextThemeOverride("light")).toBe("dark");
    expect(nextThemeOverride("dark")).toBe("unset");
  });

  it("normalises unknown values to unset", () => {
    expect(normalizeThemeOverride("purple")).toBe("unset");
    expect(normalizeThemeOverride(null)).toBe("unset");
  });

  it("unset follows the global selection; others replace it", () => {
    expect(effectiveThemeSelection("dark", "unset")).toBe("dark");
    expect(effectiveThemeSelection("light", null)).toBe("light");
    expect(effectiveThemeSelection("dark", "light")).toBe("light");
    expect(effectiveThemeSelection("light", "auto")).toBe("auto");
  });

  it("auto resolves by the sun like the global auto", () => {
    const night = { state: "below_horizon" };
    const day = { state: "above_horizon" };
    expect(resolveThemeVariant(effectiveThemeSelection("light", "auto"), night))
      .toBe("dark");
    expect(resolveThemeVariant(effectiveThemeSelection("dark", "auto"), day))
      .toBe("light");
  });

  it("stores overrides and removes the key for unset, announcing each change", () => {
    const listener = vi.fn();
    window.addEventListener(THEME_OVERRIDE_CHANGE_EVENT, listener);
    writeThemeOverride("dark");
    expect(window.localStorage.getItem(THEME_OVERRIDE_STORAGE_KEY)).toBe("dark");
    expect(readThemeOverride()).toBe("dark");
    writeThemeOverride("unset");
    expect(window.localStorage.getItem(THEME_OVERRIDE_STORAGE_KEY)).toBeNull();
    expect(readThemeOverride()).toBe("unset");
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(THEME_OVERRIDE_CHANGE_EVENT, listener);
  });

  it("survives storage that throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readThemeOverride()).toBe("unset");
    spy.mockRestore();
  });
});
