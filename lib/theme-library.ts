// Host-backed library of named theme sets. This module is intentionally free of
// React and DOM access so it can run in both the API route (server) and the
// browser. It performs *structural* normalization only: each entry's `themeSet`
// is kept as a loose record here and deep-normalized on the client by
// `normalizeThemeSet` (see app/components/accentColor.ts), mirroring how the
// shared theme is stored loosely and normalized on read.

export const THEME_LIBRARY_VERSION = 1;
export const THEME_LIBRARY_MAX_ENTRIES = 100;
export const THEME_LIBRARY_MAX_NAME_LENGTH = 60;

export type ThemeLibraryEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  themeSet: Record<string, unknown>;
};

export type ThemeLibrary = {
  version: number;
  activeId: string | null;
  entries: ThemeLibraryEntry[];
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isoStringOr(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallback;
}

function trimmedName(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return fallback;
  }
  return text.slice(0, THEME_LIBRARY_MAX_NAME_LENGTH);
}

function themeSetWithoutSharedConfig(value: Record<string, unknown>) {
  const { followVisualizerWhenActive: _sharedConfigOnly, ...themeSet } = value;
  return themeSet;
}

/**
 * A reasonably-unique id that works without crypto in any runtime. Library
 * entries are low-volume and user-named, so collision resistance only needs to
 * be good enough to avoid clashes within a single session.
 */
export function createThemeLibraryId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `theme_${Date.now().toString(36)}_${random}`;
}

export function emptyThemeLibrary(): ThemeLibrary {
  return { version: THEME_LIBRARY_VERSION, activeId: null, entries: [] };
}

export function normalizeThemeLibrary(value: unknown): ThemeLibrary {
  const record = recordValue(value);
  if (!record) {
    return emptyThemeLibrary();
  }

  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const seenIds = new Set<string>();
  const entries: ThemeLibraryEntry[] = [];

  for (const raw of rawEntries) {
    if (entries.length >= THEME_LIBRARY_MAX_ENTRIES) {
      break;
    }

    const entry = recordValue(raw);
    const themeSet = recordValue(entry?.themeSet);
    if (!entry || !themeSet) {
      continue;
    }

    let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createThemeLibraryId();
    while (seenIds.has(id)) {
      id = createThemeLibraryId();
    }
    seenIds.add(id);

    const createdAt = isoStringOr(entry.createdAt, new Date().toISOString());
    entries.push({
      id,
      name: trimmedName(entry.name, "Untitled theme"),
      createdAt,
      updatedAt: isoStringOr(entry.updatedAt, createdAt),
      themeSet: themeSetWithoutSharedConfig(themeSet),
    });
  }

  const activeId = typeof record.activeId === "string" && seenIds.has(record.activeId)
    ? record.activeId
    : null;

  return { version: THEME_LIBRARY_VERSION, activeId, entries };
}
