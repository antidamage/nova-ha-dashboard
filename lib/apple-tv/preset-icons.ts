/**
 * The glyphs a preset button may wear (Adeline, 2026-09-22).
 *
 * One icon per playlist preset, chosen in the editor beside the playlist's
 * name. This is the pure half — the ids and their readable names — so the API
 * route and the list's own normalisation can validate a stored choice without
 * pulling React, or the icons themselves, into the Node runtime;
 * `app/components/dashboard/appleTVPresetIcon.tsx` joins these ids to their
 * Lucide components. Same split, and for the same reason, as
 * `lib/reminder-glyph.ts`.
 *
 * A preset that has been given no icon stores `null` and wears the note the
 * dial's buttons have always carried, so the shipped list needs no icon at
 * all.
 */

export type PresetIconCatalogEntry = {
  id: string;
  label: string;
};

/** The curated set, in the order the picker draws it. */
export const PRESET_ICON_CATALOG: PresetIconCatalogEntry[] = [
  { id: "list-music", label: "Playlist" },
  { id: "audio-lines", label: "Levels" },
  { id: "headphones", label: "Headphones" },
  { id: "speaker", label: "Speaker" },
  { id: "radio", label: "Radio" },
  { id: "disc3", label: "Record" },
  { id: "mic", label: "Mic" },
  { id: "guitar", label: "Guitar" },
  { id: "drum", label: "Drums" },
  { id: "waves", label: "Waves" },
  { id: "flame", label: "Flame" },
  { id: "zap", label: "Bolt" },
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "sparkles", label: "Sparkle" },
  { id: "party-popper", label: "Party" },
  { id: "popcorn", label: "Popcorn" },
  { id: "martini", label: "Cocktail" },
  { id: "coffee", label: "Coffee" },
  { id: "moon", label: "Night" },
  { id: "sun", label: "Morning" },
  { id: "cloud-rain", label: "Rain" },
  { id: "ghost", label: "Ghost" },
  { id: "skull", label: "Skull" },
  { id: "crown", label: "Crown" },
  { id: "dumbbell", label: "Workout" },
];

/**
 * The note a preset button wears until an icon is chosen. Not in the catalogue:
 * it is the absence of a choice, so a picker draws it as its own tile rather
 * than as one entry among the curated set.
 */
export const DEFAULT_PRESET_ICON_ID = "music";

const CATALOG_BY_ID = new Map(PRESET_ICON_CATALOG.map((entry) => [entry.id, entry]));

/** Every id a stored choice may carry. */
export const PRESET_ICON_IDS = PRESET_ICON_CATALOG.map((entry) => entry.id);

export function presetIconCatalogEntry(id: string) {
  return CATALOG_BY_ID.get(id);
}

export function isPresetIconId(value: unknown): value is string {
  return typeof value === "string" && CATALOG_BY_ID.has(value);
}

/**
 * A stored icon choice: a catalogue id, or `null` for the note. Anything else —
 * an id a later build stopped shipping, a hand-edited file's rubbish — reads as
 * no choice rather than as a broken button, so the preset still draws.
 */
export function cleanPresetIcon(value: unknown): string | null {
  return isPresetIconId(value) ? value : null;
}
