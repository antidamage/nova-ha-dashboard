"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeThemeSet, type DeviceThemeSet } from "./accentColor";
import {
  createThemeLibraryId,
  normalizeThemeLibrary,
  THEME_LIBRARY_MAX_ENTRIES,
  type ThemeLibrary,
} from "../../lib/theme-library";

// Client-side view of the host-backed theme library. Each entry's themeSet is
// deep-normalized into a DeviceThemeSet so it is ready to apply or edit. All
// mutations are optimistic and then POSTed; the server's normalized response is
// folded back in.

export type LibraryEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  themeSet: DeviceThemeSet;
};

export type ClientThemeLibrary = {
  activeId: string | null;
  entries: LibraryEntry[];
};

const LIBRARY_ENDPOINT = "/api/theme-library";

function toClientLibrary(library: ThemeLibrary): ClientThemeLibrary {
  return {
    activeId: library.activeId,
    entries: library.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      themeSet: normalizeThemeSet(entry.themeSet as Parameters<typeof normalizeThemeSet>[0]),
    })),
  };
}

function toWireLibrary(library: ClientThemeLibrary): ThemeLibrary {
  return normalizeThemeLibrary({
    activeId: library.activeId,
    entries: library.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      themeSet: entry.themeSet as unknown as Record<string, unknown>,
    })),
  });
}

const EMPTY_LIBRARY: ClientThemeLibrary = { activeId: null, entries: [] };

export function useThemeLibrary() {
  const [library, setLibrary] = useState<ClientThemeLibrary>(EMPTY_LIBRARY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const libraryRef = useRef(library);
  const savePending = useRef(0);
  libraryRef.current = library;

  const reload = useCallback(async () => {
    // Never clobber an optimistic edit that has not been acknowledged yet.
    if (savePending.current > 0) {
      return;
    }
    try {
      const response = await fetch(LIBRARY_ENDPOINT, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Theme library request failed: ${response.status}`);
      }
      const data = (await response.json()) as { library?: unknown };
      if (savePending.current === 0) {
        setLibrary(toClientLibrary(normalizeThemeLibrary(data.library)));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load theme library");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const persist = useCallback(async (next: ClientThemeLibrary) => {
    setLibrary(next);
    setError(null);
    savePending.current += 1;
    try {
      const response = await fetch(LIBRARY_ENDPOINT, {
        body: JSON.stringify({ library: toWireLibrary(next) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Theme library update failed: ${response.status}`);
      }
      const data = (await response.json()) as { library?: unknown };
      const acknowledged = toClientLibrary(normalizeThemeLibrary(data.library));
      // Only adopt the server copy once our own writes have all drained, so a
      // slow first response can't roll back a newer optimistic edit.
      if (savePending.current === 1) {
        setLibrary(acknowledged);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save theme library");
    } finally {
      savePending.current -= 1;
    }
  }, []);

  const saveAs = useCallback((name: string, themeSet: DeviceThemeSet) => {
    const current = libraryRef.current;
    if (current.entries.length >= THEME_LIBRARY_MAX_ENTRIES) {
      setError("Theme library is full.");
      return null;
    }
    const now = new Date().toISOString();
    const id = createThemeLibraryId();
    const entry: LibraryEntry = {
      id,
      name: name.trim() || "Untitled theme",
      createdAt: now,
      updatedAt: now,
      themeSet: normalizeThemeSet(themeSet),
    };
    void persist({ activeId: id, entries: [...current.entries, entry] });
    return id;
  }, [persist]);

  const saveChanges = useCallback((themeSet: DeviceThemeSet) => {
    const current = libraryRef.current;
    if (!current.activeId) {
      return;
    }
    const now = new Date().toISOString();
    void persist({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === current.activeId
          ? { ...entry, themeSet: normalizeThemeSet(themeSet), updatedAt: now }
          : entry,
      ),
    });
  }, [persist]);

  const rename = useCallback((id: string, name: string) => {
    const current = libraryRef.current;
    const now = new Date().toISOString();
    void persist({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === id ? { ...entry, name: name.trim() || entry.name, updatedAt: now } : entry,
      ),
    });
  }, [persist]);

  const duplicate = useCallback((id: string) => {
    const current = libraryRef.current;
    const source = current.entries.find((entry) => entry.id === id);
    if (!source || current.entries.length >= THEME_LIBRARY_MAX_ENTRIES) {
      if (source) {
        setError("Theme library is full.");
      }
      return null;
    }
    const now = new Date().toISOString();
    const newId = createThemeLibraryId();
    const copy: LibraryEntry = {
      id: newId,
      name: `${source.name} Copy`.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      themeSet: normalizeThemeSet(source.themeSet),
    };
    const index = current.entries.findIndex((entry) => entry.id === id);
    const entries = [...current.entries];
    entries.splice(index + 1, 0, copy);
    void persist({ activeId: newId, entries });
    return newId;
  }, [persist]);

  const remove = useCallback((id: string) => {
    const current = libraryRef.current;
    void persist({
      activeId: current.activeId === id ? null : current.activeId,
      entries: current.entries.filter((entry) => entry.id !== id),
    });
  }, [persist]);

  const setActive = useCallback((id: string | null) => {
    const current = libraryRef.current;
    if (id !== null && !current.entries.some((entry) => entry.id === id)) {
      return;
    }
    void persist({ ...current, activeId: id });
  }, [persist]);

  return {
    library,
    ready,
    error,
    reload,
    saveAs,
    saveChanges,
    rename,
    duplicate,
    remove,
    setActive,
  };
}
