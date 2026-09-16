"use client";

// Keeps the playback engine's view of the UX sound library current.
//
// The library lives in preferences rather than the theme (a theme carries only
// ids), so it arrives on its own: fetched once on mount, and re-fetched when
// any screen uploads, renames or deletes a clip — publishSoundLibrary
// broadcasts a nudge and each client re-reads /api/sounds, which keeps one code
// path for interpreting it. See specs/ux-sounds.md.

import { useEffect } from "react";
import { setSoundLibrary } from "./controlSound";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
import type { SoundLibraryEntry } from "../../../lib/sound-library";

/** Fires locally when this screen itself changes the library, so it reloads at once. */
export const SOUND_LIBRARY_CHANGED_EVENT = "nova:sound-library-changed";

export async function fetchSoundLibrary(): Promise<SoundLibraryEntry[]> {
  const response = await fetch("/api/sounds", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to read the sound library");
  }
  const body = (await response.json()) as { entries?: SoundLibraryEntry[] };
  return Array.isArray(body.entries) ? body.entries : [];
}

export function useSoundLibrary(): void {
  useEffect(() => {
    let cancelled = false;

    const reload = () => {
      void fetchSoundLibrary()
        .then((entries) => {
          if (!cancelled) {
            setSoundLibrary(entries);
          }
        })
        .catch(() => {
          // Sounds are enhancement-only: without the library every action falls
          // back to the theme's own clip, which is the old behaviour.
        });
    };

    reload();
    window.addEventListener(SOUND_LIBRARY_CHANGED_EVENT, reload);
    const unsubscribe = subscribeToDashboardEvents({ "sound-library": reload });

    return () => {
      cancelled = true;
      window.removeEventListener(SOUND_LIBRARY_CHANGED_EVENT, reload);
      unsubscribe();
    };
  }, []);
}
