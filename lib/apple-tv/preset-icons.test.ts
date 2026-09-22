import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET_ICON_ID,
  PRESET_ICON_CATALOG,
  PRESET_ICON_IDS,
  cleanPresetIcon,
  isPresetIconId,
  presetIconCatalogEntry,
} from "./preset-icons";

describe("the preset icon catalogue", () => {
  it("names every icon once, with a label to draw under it", () => {
    expect(new Set(PRESET_ICON_IDS).size).toBe(PRESET_ICON_IDS.length);
    for (const entry of PRESET_ICON_CATALOG) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps the default note out of the catalogue: it is the absence of a choice", () => {
    expect(isPresetIconId(DEFAULT_PRESET_ICON_ID)).toBe(false);
  });
});

describe("a stored icon choice", () => {
  it("is kept when this build ships it", () => {
    for (const id of PRESET_ICON_IDS) expect(cleanPresetIcon(id)).toBe(id);
    expect(presetIconCatalogEntry("flame")?.label).toBe("Flame");
  });

  it("is no choice at all for anything else, so the button still draws a note", () => {
    expect(cleanPresetIcon("saxophone")).toBeNull();
    expect(cleanPresetIcon(undefined)).toBeNull();
    expect(cleanPresetIcon(null)).toBeNull();
    expect(cleanPresetIcon(7)).toBeNull();
    // The default note is what no choice draws, not something to store.
    expect(cleanPresetIcon(DEFAULT_PRESET_ICON_ID)).toBeNull();
  });
});
