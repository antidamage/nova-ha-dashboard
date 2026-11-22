// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_OVERRIDE_CHANGE_EVENT, THEME_OVERRIDE_STORAGE_KEY } from "./constants";
import { setThemeOverridePreview } from "./override-preview";
import { readThemeOverride, writeThemeOverride } from "./override-store";

// specs/theme-override.md, "Tour preview": wins while set, never stored, never sent.
describe("theme override preview", () => {
  afterEach(() => {
    setThemeOverridePreview(null);
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("wins over the stored override while set, and clearing it restores the stored one", () => {
    writeThemeOverride("light");
    setThemeOverridePreview("dark");
    expect(readThemeOverride()).toBe("dark");
    setThemeOverridePreview(null);
    expect(readThemeOverride()).toBe("light");
  });

  it("never writes storage or fetches, and tells this window only", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(THEME_OVERRIDE_CHANGE_EVENT, listener);
    for (const mode of ["unset", "auto", "light", "dark"] as const) setThemeOverridePreview(mode);
    setThemeOverridePreview(null);
    window.removeEventListener(THEME_OVERRIDE_CHANGE_EVENT, listener);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(THEME_OVERRIDE_STORAGE_KEY)).toBeNull();
    expect(seen).toEqual(["unset", "auto", "light", "dark", null]);
    vi.unstubAllGlobals();
  });
});
