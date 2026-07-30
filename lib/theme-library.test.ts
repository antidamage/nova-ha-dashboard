import { describe, expect, it } from "vitest";
import {
  emptyThemeLibrary,
  normalizeThemeLibrary,
  THEME_LIBRARY_MAX_ENTRIES,
  THEME_LIBRARY_MAX_NAME_LENGTH,
} from "./theme-library";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "a",
    name: "Sunset",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    themeSet: { selection: "dark", themes: { dark: {}, light: {} } },
    ...overrides,
  };
}

describe("normalizeThemeLibrary", () => {
  it("returns an empty library for non-objects", () => {
    expect(normalizeThemeLibrary(null)).toEqual(emptyThemeLibrary());
    expect(normalizeThemeLibrary("nope")).toEqual(emptyThemeLibrary());
    expect(normalizeThemeLibrary([])).toEqual(emptyThemeLibrary());
  });

  it("keeps valid entries and preserves order", () => {
    const library = normalizeThemeLibrary({
      activeId: "b",
      entries: [entry({ id: "a", name: "First" }), entry({ id: "b", name: "Second" })],
    });
    expect(library.entries.map((item) => item.id)).toEqual(["a", "b"]);
    expect(library.activeId).toBe("b");
  });

  it("removes the legacy shared visualiser-follow flag from saved themes", () => {
    const library = normalizeThemeLibrary({
      entries: [entry({
        themeSet: {
          followVisualizerWhenActive: true,
          selection: "dark",
          themes: { dark: {}, light: {} },
        },
      })],
    });
    expect(library.entries[0].themeSet).not.toHaveProperty("followVisualizerWhenActive");
  });

  it("drops entries without a themeSet object", () => {
    const library = normalizeThemeLibrary({
      entries: [entry(), entry({ id: "b", themeSet: null }), entry({ id: "c", themeSet: "x" })],
    });
    expect(library.entries.map((item) => item.id)).toEqual(["a"]);
  });

  it("clears activeId when it does not match a surviving entry", () => {
    const library = normalizeThemeLibrary({
      activeId: "missing",
      entries: [entry()],
    });
    expect(library.activeId).toBeNull();
  });

  it("de-duplicates ids and assigns fresh ones", () => {
    const library = normalizeThemeLibrary({
      entries: [entry({ id: "dup" }), entry({ id: "dup" })],
    });
    const ids = library.entries.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("trims names and caps their length", () => {
    const long = "x".repeat(200);
    const library = normalizeThemeLibrary({ entries: [entry({ name: `  ${long}  ` })] });
    expect(library.entries[0].name).toHaveLength(THEME_LIBRARY_MAX_NAME_LENGTH);
  });

  it("falls back to a placeholder name when empty", () => {
    const library = normalizeThemeLibrary({ entries: [entry({ name: "   " })] });
    expect(library.entries[0].name).toBe("Untitled theme");
  });

  it("caps the number of entries", () => {
    const entries = Array.from({ length: THEME_LIBRARY_MAX_ENTRIES + 10 }, (_, index) =>
      entry({ id: `id-${index}` }),
    );
    const library = normalizeThemeLibrary({ entries });
    expect(library.entries).toHaveLength(THEME_LIBRARY_MAX_ENTRIES);
  });
});
