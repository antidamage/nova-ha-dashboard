/**
 * The UX sound library: the clips a theme's action assignments point at.
 *
 * Built-ins ship as files under `public/sounds/ux/` and are derived from the
 * constant below at read time, so they never leave an orphaned manifest row
 * behind when one is renamed or dropped. Uploads live under `data/sounds/` and
 * are the only entries the manifest in `preferences.soundLibrary` records.
 *
 * Unlike the old single control sound, no audio bytes go into the theme — a
 * theme carries only ids. See specs/ux-sounds.md.
 */

export type SoundOrigin = "builtin" | "upload";

export type SoundLibraryEntry = {
  id: string;
  name: string;
  origin: SoundOrigin;
  bytes: number;
  updatedAt: string | null;
};

export type SoundLibrary = { entries: SoundLibraryEntry[] };

export const SOUND_LIBRARY_MAX_NAME_LENGTH = 120;
export const SOUND_LIBRARY_MAX_ID_LENGTH = 60;
export const SOUND_LIBRARY_MAX_UPLOADS = 40;
/** Same ceiling the single control sound used: plenty for a UI click. */
export const SOUND_FILE_MAX_BYTES = 1_000_000;

/** Served statically from `public/sounds/ux/<id>.mp3`. */
export const BUILTIN_SOUNDS: readonly { id: string; name: string }[] = [
  // The six timer chimes, copied out of `public/sounds/timer-*.mp3` so any
  // action can use one, not just the timer alert. The timer picker still reads
  // its own copies; these are separate files under their own ids.
  { id: "chime-classic", name: "Chime (classic)" },
  { id: "chime-magical", name: "Chime (magical)" },
  { id: "chime-motion-tracker", name: "Chime (motion tracker)" },
  { id: "chime-retro-boop", name: "Chime (retro boop)" },
  { id: "chime-soft-boop", name: "Chime (soft boop)" },
  { id: "chime-tink", name: "Chime (tink)" },
  { id: "chunky-mechanical-click", name: "Chunky mechanical click" },
  { id: "light-mechanical-click", name: "Light mechanical click" },
  { id: "light-ratchet", name: "Light ratchet" },
  { id: "medium-mechanical-click", name: "Medium mechanical click" },
  { id: "medium-ratchet", name: "Medium ratchet" },
  { id: "soft-mechanical-click", name: "Soft mechanical click" },
];

const BUILTIN_IDS = new Set(BUILTIN_SOUNDS.map((sound) => sound.id));

export function isBuiltinSoundId(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

/** Where a clip is fetched from. Built-ins are static; uploads go through the API. */
export function soundUrl(entry: Pick<SoundLibraryEntry, "id" | "origin">): string {
  return entry.origin === "builtin" ? `/sounds/ux/${entry.id}.mp3` : `/api/sounds/${entry.id}`;
}

/**
 * A filename or display name reduced to an id: lowercase, one hyphen per run of
 * anything that is not a letter or digit, no leading or trailing hyphens.
 */
export function slugifySoundId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SOUND_LIBRARY_MAX_ID_LENGTH)
    .replace(/-+$/, "");
  return slug || "sound";
}

/** `slugifySoundId` plus a numeric suffix until nothing else holds the id. */
export function uniqueSoundId(value: string, taken: Iterable<string>): string {
  const base = slugifySoundId(value);
  const used = new Set(taken);
  if (!used.has(base) && !BUILTIN_IDS.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, SOUND_LIBRARY_MAX_ID_LENGTH - 4)}-${suffix}`;
    if (!used.has(candidate) && !BUILTIN_IDS.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not find a free sound id");
}

export function normalizeSoundName(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().slice(0, SOUND_LIBRARY_MAX_NAME_LENGTH);
  return trimmed || fallback;
}

function normalizeUploadEntry(value: unknown): SoundLibraryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Partial<SoundLibraryEntry>;
  if (typeof entry.id !== "string") {
    return null;
  }
  const id = slugifySoundId(entry.id);
  // A built-in owns its id outright; a manifest row claiming one is corrupt.
  if (BUILTIN_IDS.has(id)) {
    return null;
  }
  return {
    id,
    name: normalizeSoundName(entry.name, id),
    origin: "upload",
    bytes: Number.isFinite(entry.bytes) ? Math.max(0, Math.trunc(Number(entry.bytes))) : 0,
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
  };
}

/**
 * The stored manifest, cleaned: uploads only, deduplicated by id, capped.
 * Built-ins are added by `soundLibraryWithBuiltins`, never stored.
 */
export function normalizeSoundLibrary(value: unknown): SoundLibrary {
  const raw = (value as SoundLibrary | undefined)?.entries;
  if (!Array.isArray(raw)) {
    return { entries: [] };
  }

  const seen = new Set<string>();
  const entries: SoundLibraryEntry[] = [];
  for (const candidate of raw) {
    const entry = normalizeUploadEntry(candidate);
    if (!entry || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= SOUND_LIBRARY_MAX_UPLOADS) {
      break;
    }
  }
  return { entries };
}

/**
 * The full list the config lists and the player resolves against: built-ins
 * first, then uploads, each group alphabetical by name (specs/ux-sounds.md).
 */
export function soundLibraryWithBuiltins(stored: SoundLibrary): SoundLibraryEntry[] {
  const byName = (a: SoundLibraryEntry, b: SoundLibraryEntry) => a.name.localeCompare(b.name);
  const builtins: SoundLibraryEntry[] = BUILTIN_SOUNDS.map((sound) => ({
    ...sound,
    origin: "builtin",
    bytes: 0,
    updatedAt: null,
  }));
  return [...builtins.sort(byName), ...[...stored.entries].sort(byName)];
}
