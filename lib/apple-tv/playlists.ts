/**
 * The playlist presets the amplifier dial offers (Adeline, 2026-09-22).
 *
 * The dial is the IR emitter's placeholder: its preset buttons will play an
 * Apple Music playlist on the Apple TV. This module owns the list's shape —
 * the shipped defaults, the bounds, and the normalisation every reader and the
 * API route share — so a hand-typed name cannot break a preset row.
 */

/** The three shipped presets, in order. */
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
 * A list as it is stored: names cleaned, blanks dropped, duplicates removed
 * keeping the first, and the list bounded. Anything that is not an array is an
 * empty list, so a caller can tell "no presets" from "never set" — the default
 * set is `storedPlaylists`' business, not this one's.
 */
export function cleanPlaylists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const name = cleanPlaylistName(entry);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
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
export function storedPlaylists(value: unknown): string[] {
  if (value === undefined || value === null || !Array.isArray(value)) return [...DEFAULT_PLAYLISTS];
  return cleanPlaylists(value);
}
