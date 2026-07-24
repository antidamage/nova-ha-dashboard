"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createVoicePersonalityId,
  normalizeVoicePersonalityLibrary,
  VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES,
  type VoicePersonalityLibrary,
} from "../../lib/voice-personality-library";
import {
  normalizeVoicePersonalitySet,
  type VoiceEngine,
  type VoicePersonalitySet,
} from "../../lib/voice-settings";

// Client-side view of the host-backed voice personality library. Mirrors
// app/components/themeLibrary.ts: mutations are optimistic and then POSTed, and
// the server's normalized response is folded back in once local writes drain.

export type PersonalityLibraryEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  personality: VoicePersonalitySet;
  engine?: VoiceEngine;
};

export type ClientVoicePersonalityLibrary = {
  activeId: string | null;
  entries: PersonalityLibraryEntry[];
};

const LIBRARY_ENDPOINT = "/api/voice-personality-library";

function toClientLibrary(library: VoicePersonalityLibrary): ClientVoicePersonalityLibrary {
  return {
    activeId: library.activeId,
    entries: library.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      personality: entry.personality,
      ...(entry.engine ? { engine: entry.engine } : {}),
    })),
  };
}

const EMPTY_LIBRARY: ClientVoicePersonalityLibrary = { activeId: null, entries: [] };

export function useVoicePersonalityLibrary() {
  const [library, setLibrary] = useState<ClientVoicePersonalityLibrary>(EMPTY_LIBRARY);
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
        throw new Error(`Voice personality library request failed: ${response.status}`);
      }
      const data = (await response.json()) as { library?: unknown };
      if (savePending.current === 0) {
        setLibrary(toClientLibrary(normalizeVoicePersonalityLibrary(data.library)));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load voice personality library");
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

  const persist = useCallback(async (next: ClientVoicePersonalityLibrary) => {
    setLibrary(next);
    setError(null);
    savePending.current += 1;
    try {
      const response = await fetch(LIBRARY_ENDPOINT, {
        body: JSON.stringify({ library: normalizeVoicePersonalityLibrary(next) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Voice personality library update failed: ${response.status}`);
      }
      const data = (await response.json()) as { library?: unknown };
      const acknowledged = toClientLibrary(normalizeVoicePersonalityLibrary(data.library));
      // Only adopt the server copy once our own writes have all drained, so a
      // slow first response can't roll back a newer optimistic edit.
      if (savePending.current === 1) {
        setLibrary(acknowledged);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save voice personality library");
    } finally {
      savePending.current -= 1;
    }
  }, []);

  const saveAs = useCallback(
    (name: string, personality: VoicePersonalitySet, engine?: VoiceEngine) => {
      const current = libraryRef.current;
      if (current.entries.length >= VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES) {
        setError("Voice personality library is full.");
        return null;
      }
      const now = new Date().toISOString();
      const id = createVoicePersonalityId();
      const entry: PersonalityLibraryEntry = {
        id,
        name: name.trim() || "Untitled personality",
        createdAt: now,
        updatedAt: now,
        personality: normalizeVoicePersonalitySet(personality),
        // Stamp the engine this profile was saved under so the picker can list
        // it only while that engine is loaded.
        ...(engine ? { engine } : {}),
      };
      void persist({ activeId: id, entries: [...current.entries, entry] });
      return id;
    },
    [persist],
  );

  const saveChanges = useCallback((personality: VoicePersonalitySet) => {
    const current = libraryRef.current;
    if (!current.activeId) {
      return;
    }
    const now = new Date().toISOString();
    void persist({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === current.activeId
          ? { ...entry, personality: normalizeVoicePersonalitySet(personality), updatedAt: now }
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
    if (!source || current.entries.length >= VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES) {
      if (source) {
        setError("Voice personality library is full.");
      }
      return null;
    }
    const now = new Date().toISOString();
    const newId = createVoicePersonalityId();
    const copy: PersonalityLibraryEntry = {
      id: newId,
      name: `${source.name} Copy`.slice(0, 60),
      createdAt: now,
      updatedAt: now,
      personality: normalizeVoicePersonalitySet(source.personality),
      ...(source.engine ? { engine: source.engine } : {}),
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
