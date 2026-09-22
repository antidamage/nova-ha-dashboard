/**
 * The playlist presets the amplifier dial offers (Adeline, 2026-09-22).
 *
 * The dial is the IR emitter's placeholder: each preset button will play one
 * Apple Music playlist on the Apple TV, wearing an icon of its own and carrying
 * the way it should be played. This module owns the list's shape — the shipped
 * defaults, the bounds, and the normalisation every reader and the API route
 * share — so a hand-typed name cannot break a preset row.
 *
 * A stored list is a list of **presets**, not of names: `{ name, icon, shuffle,
 * repeat }`. A file written before the icon and the playback type existed holds
 * bare names, and those read as presets with nothing set — the file outlives
 * the build that wrote it.
 */
import { cleanPresetIcon } from "./preset-icons";

/**
 * How a preset plays its playlist through. Apple Music's own three: no repeat,
 * repeat the playlist, or the endless mode that keeps going once it runs out.
 * The order here is the order the button cycles.
 */
export const REPEAT_MODES = ["off", "all", "infinite"] as const;
export type AppleTVRepeatMode = (typeof REPEAT_MODES)[number];

/** What each mode is called where a person reads it. */
export const REPEAT_MODE_LABELS: Record<AppleTVRepeatMode, string> = {
  off: "Play once",
  all: "Loop",
  infinite: "Endless",
};

/** One preset button: the playlist it plays, and the way it plays it. */
export type AppleTVPlaylist = {
  name: string;
  /** A `preset-icons` catalogue id, or null for the note. */
  icon: string | null;
  shuffle: boolean;
  repeat: AppleTVRepeatMode;
};

/**
 * The three shipped presets, in order. Names alone: the shipped list carries no
 * icons and no playback type, so every one of them reads as a preset with
 * nothing set.
 */
export const DEFAULT_PLAYLISTS = ["Excellent", "Sword Smoke & Temple Drums", "Cool"];

/**
 * How many playlists a dial may carry. Each one is a button under the dial, so
 * the list is bounded rather than free: six is three above the shipped set,
 * which is as many as fits the Quick Access tile and a zone panel's half-width
 * preset row without wrapping to a second row.
 */
export const MAX_PLAYLISTS = 6;

/** One name's length limit, so a long paste cannot run away with the row. */
export const MAX_PLAYLIST_NAME = 60;

/** A name as it is stored: trimmed, single-spaced and bounded. */
export function cleanPlaylistName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PLAYLIST_NAME);
}

/**
 * A playback type as it is stored: one of the three, and anything else reads as
 * no repeat at all — the way the shipped list plays, and never a mode nobody
 * asked for.
 */
export function cleanRepeatMode(value: unknown): AppleTVRepeatMode {
  return REPEAT_MODES.includes(value as AppleTVRepeatMode) ? (value as AppleTVRepeatMode) : "off";
}

/** The mode the button moves to next: play once, loop, endless, round again. */
export function nextRepeatMode(mode: AppleTVRepeatMode): AppleTVRepeatMode {
  return REPEAT_MODES[(REPEAT_MODES.indexOf(mode) + 1) % REPEAT_MODES.length];
}

/** The shipped three, as presets. */
function defaultPlaylists(): AppleTVPlaylist[] {
  return DEFAULT_PLAYLISTS.map((name) => ({ name, icon: null, shuffle: false, repeat: "off" }));
}

/**
 * One entry as it is stored, or null for an entry with no name to store.
 *
 * A bare string is a preset written by a build that predates the icon and the
 * playback type, so it is read as a name with nothing set rather than dropped.
 * Every field is taken from what the entry carries and normalised: an icon this
 * build does not ship, a mode it does not know, a `shuffle` that is not
 * `true` — each reads as unset.
 */
export function cleanPlaylistEntry(value: unknown): AppleTVPlaylist | null {
  const source = (typeof value === "string" ? { name: value } : value ?? {}) as Partial<Record<keyof AppleTVPlaylist, unknown>>;
  const name = cleanPlaylistName(source.name);
  if (!name) return null;
  return {
    name,
    icon: cleanPresetIcon(source.icon),
    shuffle: source.shuffle === true,
    repeat: cleanRepeatMode(source.repeat),
  };
}

/**
 * What a preset does to its playlist, in words, for a button's label. Nothing
 * at all for the ordinary case — played through once, in order — because that
 * is what a playlist does when nobody says otherwise.
 */
export function playlistModeWords(playlist: AppleTVPlaylist): string[] {
  const words: string[] = [];
  if (playlist.shuffle) words.push("shuffled");
  if (playlist.repeat === "all") words.push("looping");
  if (playlist.repeat === "infinite") words.push("endless");
  return words;
}

/**
 * A list as it is stored: names cleaned, blanks dropped, duplicates removed
 * keeping the first, and the list bounded. Anything that is not an array is an
 * empty list, so a caller can tell "no presets" from "never set" — the default
 * set is `storedPlaylists`' business, not this one's.
 */
export function cleanPlaylists(value: unknown): AppleTVPlaylist[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: AppleTVPlaylist[] = [];
  for (const entry of value) {
    const playlist = cleanPlaylistEntry(entry);
    if (!playlist) continue;
    const key = playlist.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(playlist);
    if (out.length >= MAX_PLAYLISTS) break;
  }
  return out;
}

/**
 * The list a reader draws. An unset preference — nothing stored, or a value
 * that is not a list at all — is the three shipped playlists; a stored list is
 * used as it is, even an empty one, because clearing every row is a decision
 * the owner made rather than a missing setting.
 */
export function storedPlaylists(value: unknown): AppleTVPlaylist[] {
  if (value === undefined || value === null || !Array.isArray(value)) return defaultPlaylists();
  return cleanPlaylists(value);
}
