/**
 * Colour theme group maths: new ids, the genre picker's suggestions, and the
 * exclusive-genre steal. Split out of `ColorGroupEditor.tsx`
 * (specs/agent-token-footprint.md §4).
 */
import type { PhonoscopeColorGroup } from "../../../lib/types";

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Genres the picker offers before the user types their own. */
export const GENRE_SUGGESTIONS = [
  "Alternative", "Ambient", "Blues", "Classical", "Country", "Dance", "Drum & Bass",
  "Electronic", "Folk", "Funk", "Hip-Hop", "House", "Indie", "Jazz", "Metal", "Pop",
  "Punk", "R&B", "Reggae", "Rock", "Soul", "Soundtrack", "Techno", "Trance",
];

export function newColorGroup(moduleId: string, name: string): PhonoscopeColorGroup {
  return { id: newId("group"), moduleId, name, entries: [], genres: [], isDefault: false };
}

/**
 * Assigning a genre steals it. The editor performs the steal explicitly so the
 * most recent assignment is the one that survives normalisation, which resolves
 * duplicates first-wins.
 */
export function withExclusiveGenres(
  groups: PhonoscopeColorGroup[],
  ownerId: string,
): PhonoscopeColorGroup[] {
  const owner = groups.find((group) => group.id === ownerId);
  if (!owner) return groups;
  const claimed = new Set(owner.genres.map((genre) => genre.toLowerCase()));
  return groups.map((group) => group.id === ownerId ? group : {
    ...group,
    genres: group.genres.filter((genre) => !claimed.has(genre.toLowerCase())),
  });
}
