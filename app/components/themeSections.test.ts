import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, type DeviceTheme } from "./accentColor";
import { extractSection, mergeSection } from "./themeSections";

function baseTheme(): DeviceTheme {
  return structuredClone(DEFAULT_THEME);
}

describe("theme section copy/paste", () => {
  it("extracts only the fields that belong to a section", () => {
    const payload = extractSection(baseTheme(), "map");
    expect(Object.keys(payload).sort()).toEqual(
      [
        "map",
        "mapBuildingOpacity",
        "mapLabelSize",
        "mapSatellite",
        "mapWater",
        "radarOpacity",
        "radarPaletteMode",
      ].sort(),
    );
    expect(payload).not.toHaveProperty("accent");
  });

  it("round-trips a section without touching other fields", () => {
    const source = baseTheme();
    source.map.water = { cursor: { x: 0.2, y: 0.4 }, intensity: 80, rgb: [10, 20, 30] };
    const target = baseTheme();

    const merged = mergeSection(target, "map", extractSection(source, "map"));

    expect(merged.map.water.rgb).toEqual([10, 20, 30]);
    // Colours section is untouched by a map paste.
    expect(merged.accent).toEqual(target.accent);
  });

  it("copies desktop wallpaper refs with the background section", () => {
    const source = baseTheme();
    source.desktopWallpaper = {
      landscapeAssetId: "wallpaper_00000000-0000-0000-0000-000000000000",
      portraitAssetId: null,
    };
    const target = baseTheme();

    const merged = mergeSection(target, "background", extractSection(source, "background"));

    expect(merged.desktopWallpaper.landscapeAssetId).toBe("wallpaper_00000000-0000-0000-0000-000000000000");
  });

  it("keeps voice transcript colours in the theme colours section", () => {
    const source = baseTheme();
    source.voiceTranscriptColors.background = {
      cursor: { x: 0.2, y: 0.4 },
      intensity: 80,
      rgb: [10, 20, 30],
    };
    const target = baseTheme();

    const merged = mergeSection(target, "themeColours", extractSection(source, "themeColours"));

    expect(merged.voiceTranscriptColors.background.rgb).toEqual([10, 20, 30]);
    expect(merged.map).toEqual(target.map);
  });

  it("ignores foreign keys in a payload (no cross-section leakage)", () => {
    const target = baseTheme();
    const tampered = {
      ...extractSection(baseTheme(), "reminders"),
      accent: { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [1, 2, 3] },
    } as ReturnType<typeof extractSection>;

    const merged = mergeSection(target, "reminders", tampered);

    expect(merged.accent).toEqual(target.accent);
  });

  it("clones extracted values so later edits don't mutate the clipboard", () => {
    const source = baseTheme();
    const payload = extractSection(source, "statusOrb");
    source.avatar.gymNumberOpacity = 1;
    expect((payload.avatar as DeviceTheme["avatar"]).gymNumberOpacity).not.toBe(1);
  });
});
