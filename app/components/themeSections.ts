import type { DeviceTheme } from "./accentColor";

// A "section" is a group of related theme fields surfaced under one accordion in
// the editor. Section copy/paste moves a whole group between theme variants (and
// between saved themes), and is type-guarded: a "map" payload can only ever be
// pasted into another theme's map, never into its colours or background.

export type ThemeSectionKind = "themeColours" | "typography" | "background" | "map" | "statusOrb" | "reminders" | "sound";

export const THEME_SECTION_LABELS: Record<ThemeSectionKind, string> = {
  themeColours: "Theme Colours",
  typography: "Fonts",
  background: "Background",
  map: "Map",
  statusOrb: "Status Orb",
  reminders: "Reminders",
  sound: "Sound",
};

// The fields that belong to each section. `extractSection`/`mergeSection` only
// ever read and write these keys, so unrelated controls in a section are left
// untouched and cross-section pastes are impossible.
const SECTION_FIELDS: Record<ThemeSectionKind, ReadonlyArray<keyof DeviceTheme>> = {
  themeColours: ["accent", "highlight", "background", "border", "titleColors", "clockColor", "titleTone", "voiceTranscriptColors"],
  typography: ["font", "clockFont"],
  background: ["backgroundEffect", "desktopWallpaper"],
  map: [
    "map",
    "mapBuildingOpacity",
    "mapLabelSize",
    "mapSatellite",
    "mapWater",
    "radarOpacity",
    "radarPaletteMode",
  ],
  statusOrb: ["avatar"],
  reminders: ["taskGlowIntensity"],
  sound: ["controlSound"],
};

export type ThemeSectionPayload = Partial<DeviceTheme>;

/** Deep clone so a copied section is never mutated by later edits to its source. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export function extractSection(theme: DeviceTheme, kind: ThemeSectionKind): ThemeSectionPayload {
  const payload: ThemeSectionPayload = {};
  for (const field of SECTION_FIELDS[kind]) {
    (payload as Record<string, unknown>)[field as string] = clone(theme[field]);
  }
  return payload;
}

/**
 * Merge a previously-extracted section payload onto a theme. Only the keys that
 * belong to `kind` are applied, so a malformed or mismatched payload can never
 * leak fields from another section.
 */
export function mergeSection(
  theme: DeviceTheme,
  kind: ThemeSectionKind,
  payload: ThemeSectionPayload,
): DeviceTheme {
  const next: DeviceTheme = { ...theme };
  for (const field of SECTION_FIELDS[kind]) {
    if (payload[field] !== undefined) {
      (next as Record<string, unknown>)[field as string] = clone(payload[field]);
    }
  }
  return next;
}
