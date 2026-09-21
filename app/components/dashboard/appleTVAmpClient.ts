"use client";

/**
 * The amplifier dial's page store: one shared value pair for every mount, the
 * playlist list, and the API call that saves it.
 *
 * The volume and the mute state are **placeholders** (Adeline, 2026-09-22).
 * The IR emitter that will drive the amplifier has no endpoint yet, so nothing
 * here sends a command and nothing is persisted on the host beyond the playlist
 * list: the volume lives in this store for the session, which is enough for the
 * dial to behave like a dial — and for the two mounts on screen at once (Quick
 * Access and the Lounge panel) to agree, the way the climate knobs share one
 * command instance.
 *
 * Demo mode keeps everything in sessionStorage: the e2e harness runs the
 * dashboard with no host behind `/api`, exactly as the lighting rules client
 * does.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_PLAYLISTS, MAX_PLAYLISTS, cleanPlaylists, storedPlaylists } from "../../../lib/apple-tv/playlists";
import { VOLUME_MAX, clampVolume } from "../appleTVEncoderModel";

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const DEMO_KEY = "nova.dashboard.demoAppleTVAmp.v1";
const API = "/api/appletv";

/** Where the placeholder volume starts: mid-scale, so the ring reads. */
export const PLACEHOLDER_VOLUME = 40;

export type AppleTVAmpSnapshot = {
  playlists: string[];
  volume: number;
  muted: boolean;
  /** The playlist a preset button last chose, or null for none. */
  presetIndex: number | null;
  loaded: boolean;
  saving: boolean;
  error: string | null;
};

const INITIAL: AppleTVAmpSnapshot = {
  playlists: [...DEFAULT_PLAYLISTS],
  volume: PLACEHOLDER_VOLUME,
  muted: false,
  presetIndex: null,
  loaded: false,
  saving: false,
  error: null,
};

let snapshot: AppleTVAmpSnapshot = INITIAL;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<AppleTVAmpSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function readDemo(): Partial<AppleTVAmpSnapshot> {
  try {
    const raw = window.sessionStorage.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AppleTVAmpSnapshot> : null;
    if (parsed) return parsed;
  } catch {
    // An unreadable demo store starts at the shipped defaults.
  }
  return {};
}

function writeDemo(next: Partial<AppleTVAmpSnapshot>) {
  try {
    const current = readDemo();
    window.sessionStorage.setItem(DEMO_KEY, JSON.stringify({ ...current, ...next }));
  } catch {
    // Demo persistence is best effort.
  }
}

async function load() {
  if (DEMO_MODE) {
    const stored = readDemo();
    publish({
      playlists: storedPlaylists(stored.playlists),
      volume: clampVolume(stored.volume ?? PLACEHOLDER_VOLUME),
      muted: stored.muted === true,
      presetIndex: typeof stored.presetIndex === "number" ? stored.presetIndex : null,
      loaded: true,
      error: null,
    });
    return;
  }
  try {
    const response = await fetch(API);
    if (!response.ok) throw new Error("Could not read the playlists");
    const body = await response.json() as { playlists?: unknown };
    publish({ playlists: storedPlaylists(body.playlists), loaded: true, error: null });
  } catch (cause) {
    publish({ error: cause instanceof Error ? cause.message : "Could not read the playlists" });
  }
}

function ensureLoaded() {
  if (!loading) {
    loading = load().finally(() => {
      if (!snapshot.loaded) loading = null;
    });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resets the page store; tests only. */
export function resetAppleTVAmpForTest() {
  snapshot = INITIAL;
  loading = null;
}

export function useAppleTVAmp() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(ensureLoaded, []);

  const save = useCallback(async (playlists: string[]) => {
    setError(null);
    publish({ playlists, saving: true });
    try {
      if (DEMO_MODE) {
        writeDemo({ playlists });
        return;
      }
      const response = await fetch(API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playlists }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; playlists?: unknown };
      if (!response.ok) throw new Error(payload.error ?? "Could not save the playlists");
      // Read back rather than trusting the echo: the host normalises the list.
      publish({ playlists: storedPlaylists(payload.playlists ?? playlists) });
    } catch (cause) {
      publish({ playlists: snapshot.playlists });
      setError(cause instanceof Error ? cause.message : "Could not save the playlists");
    } finally {
      publish({ saving: false });
    }
  }, []);

  /** One action for every edit: the list is always written whole. */
  const setPlaylists = useCallback((names: string[]) => {
    void save(cleanPlaylists(names.slice(0, MAX_PLAYLISTS)));
  }, [save]);

  return useMemo(() => ({
    ...state,
    error: error ?? state.error,
    setPlaylists,
    addPlaylist: (name: string) =>
      setPlaylists([...snapshot.playlists.slice(0, MAX_PLAYLISTS), name]),
    removePlaylist: (index: number) =>
      setPlaylists(snapshot.playlists.filter((_, at) => at !== index)),
    renamePlaylist: (index: number, name: string) =>
      setPlaylists(snapshot.playlists.map((entry, at) => (at === index ? name : entry))),
    /** Placeholder: mark a preset as chosen. No Apple Music call yet. */
    choosePreset: (index: number | null) => {
      publish({ presetIndex: index });
      writeDemo({ presetIndex: index });
    },
    setMuted: (muted: boolean) => {
      publish({ muted });
      writeDemo({ muted });
    },
    setVolume: (volume: number) => {
      const next = clampVolume(Math.max(0, Math.min(VOLUME_MAX, volume)));
      publish({ volume: next });
      writeDemo({ volume: next });
    },
  }), [error, save, setPlaylists, state]);
}

/** The store's current value, for a component that only needs to read it once. */
export const appleTVAmpState = () => snapshot;
