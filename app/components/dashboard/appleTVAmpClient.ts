"use client";

/**
 * The amplifier dial's page store: one shared value pair for every mount, the
 * preset list, and the API call that saves it.
 *
 * The **volume reading is a placeholder** (Adeline, 2026-09-22): the IR emitter
 * that will drive the amplifier has no endpoint yet, so the number lives in this
 * store for the session and is not persisted on the host. That is enough for the
 * dial to behave like a dial — and for the two mounts on screen at once (Quick
 * Access and the Lounge panel) to agree, the way the climate knobs share one
 * command instance.
 *
 * The **mute does command**, and so does a preset press: the Apple TV has no
 * mute of its own, so muting is `volume_set 0` and unmuting is the reading this
 * store is holding, and a press hands the playlist's name to our own app on the
 * television (`specs/apple-tv-volume.md` §Play and §The dial's mute).
 *
 * A preset press is the one thing here that **does** command: `/api/appletv/play`
 * wakes the Apple TV and starts the Music app with the preset's settings on it
 * (specs/apple-tv-volume.md §Play). The list itself is stored on the host,
 * because it is configuration rather than device state.
 *
 * Demo mode keeps everything in sessionStorage: the e2e harness runs the
 * dashboard with no host behind `/api`, exactly as the lighting rules client
 * does.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  MAX_PLAYLISTS,
  cleanPlaylistEntry,
  cleanPlaylists,
  storedPlaylists,
  type AppleTVPlaylist,
} from "../../../lib/apple-tv/playlists";
import { VOLUME_MAX, clampVolume } from "../appleTVEncoderModel";
import { DEMO_MODE, readDemoAmpState, writeDemoAmpState } from "./appleTVAmpDemo";
import { sendAmpMute, sendPresetPlay } from "./appleTVAmpCommands";
import { readPlayResult, type AppleTVPlayResult } from "./appleTVPlayResult";

const API = "/api/appletv";

/** Where the placeholder volume starts: mid-scale, so the ring reads. */
export const PLACEHOLDER_VOLUME = 40;

export type AppleTVAmpSnapshot = {
  playlists: AppleTVPlaylist[];
  /** What the Apple TV's app last reported doing with a press, when it has. */
  lastPlay: AppleTVPlayResult | null;
  volume: number;
  muted: boolean;
  loaded: boolean;
  saving: boolean;
  error: string | null;
};

const INITIAL: AppleTVAmpSnapshot = {
  playlists: storedPlaylists(undefined),
  lastPlay: null,
  volume: PLACEHOLDER_VOLUME,
  muted: false,
  loaded: false,
  saving: false,
  error: null,
};

let snapshot: AppleTVAmpSnapshot = INITIAL;
let loading: Promise<void> | null = null;
/**
 * Which save is current. Two saves can overlap — a blur-commit during a slow
 * request — and the older one's answer must not land on top of the newer one's:
 * without this, a failed first save would restore a list the second save has
 * already replaced.
 */
let saveGeneration = 0;
/**
 * Which mute is current, the way `saveGeneration` tracks saves: two taps in
 * flight mean the first one's failure must not flip a dial the second one owns.
 */
let muteGeneration = 0;
const listeners = new Set<() => void>();

function publish(next: Partial<AppleTVAmpSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

async function load() {
  if (DEMO_MODE) {
    const stored = readDemoAmpState<AppleTVAmpSnapshot>();
    publish({
      playlists: storedPlaylists(stored.playlists),
      volume: clampVolume(stored.volume ?? PLACEHOLDER_VOLUME),
      muted: stored.muted === true,
      loaded: true,
      error: null,
    });
    return;
  }
  try {
    const response = await fetch(API);
    if (!response.ok) throw new Error("Could not read the playlists");
    const body = await response.json() as { lastPlay?: unknown; playlists?: unknown };
    publish({ playlists: storedPlaylists(body.playlists), lastPlay: readPlayResult(body.lastPlay), loaded: true, error: null });
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

/** Resets the page store, and the play seam with it; tests only. */
export function resetAppleTVAmpForTest() {
  snapshot = INITIAL;
  loading = null;
  saveGeneration = 0;
  muteGeneration = 0;
}

export function useAppleTVAmp() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(ensureLoaded, []);

  const save = useCallback(async (playlists: AppleTVPlaylist[]) => {
    setError(null);
    // The list the caller is rolling back to. Publishing the optimistic list
    // first means `snapshot.playlists` is already the NEW one by the time the
    // request fails, so a rollback that reads it back republishes the list the
    // host rejected — the buttons would show presets that were never stored.
    const previous = snapshot.playlists;
    const generation = (saveGeneration += 1);
    const superseded = () => generation !== saveGeneration;
    publish({ playlists, saving: true });
    try {
      if (DEMO_MODE) {
        writeDemoAmpState<AppleTVAmpSnapshot>({ playlists });
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
      if (!superseded()) publish({ playlists: storedPlaylists(payload.playlists ?? playlists) });
    } catch (cause) {
      // A later save owns the list now: its answer, not this failure's, is the
      // one to keep.
      if (!superseded()) {
        publish({ playlists: previous });
        setError(cause instanceof Error ? cause.message : "Could not save the playlists");
      }
    } finally {
      if (!superseded()) publish({ saving: false });
    }
  }, []);

  /** One action for every edit: the list is always written whole. */
  const setPlaylists = useCallback((presets: AppleTVPlaylist[]) => {
    void save(cleanPlaylists(presets.slice(0, MAX_PLAYLISTS)));
  }, [save]);

  return useMemo(() => ({
    ...state,
    error: error ?? state.error,
    setPlaylists,
    addPlaylist: (name: string) => {
      const preset = cleanPlaylistEntry(name);
      if (preset) setPlaylists([...snapshot.playlists.slice(0, MAX_PLAYLISTS), preset]);
    },
    removePlaylist: (index: number) =>
      setPlaylists(snapshot.playlists.filter((_, at) => at !== index)),
    /** A rename keeps the preset's own icon and playback type. */
    renamePlaylist: (index: number, name: string) =>
      setPlaylists(snapshot.playlists.map((entry, at) => (at === index ? { ...entry, name } : entry))),
    /** The icon a preset's button wears, and the way it plays: one write each. */
    updatePreset: (index: number, patch: Partial<Omit<AppleTVPlaylist, "name">>) =>
      setPlaylists(snapshot.playlists.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))),
    /**
     * Fire a preset's play event. One shot by design: the button is a command,
     * not a choice of state, so nothing stays selected — a preset left lit
     * would read as "this is what is playing", which this store cannot know
     * (Adeline, 2026-09-22).
     *
     * `/api/appletv/play` wakes the Apple TV, brings the Music app forward,
     * applies the preset's shuffle and repeat, and starts playback. The demo
     * build calls nothing: it has no Apple TV behind `/api`, the same way its
     * list is kept in sessionStorage.
     */
    playPreset: (index: number) => {
      if (!snapshot.playlists[index] || DEMO_MODE) return;
      setError(null);
      void sendPresetPlay(index).then((message) => {
        if (message) setError(message);
      });
    },
    /**
     * The dial's mute, through the Apple TV: it has no mute of its own, so this
     * is `volume_set 0` and, coming back, the level this dial is holding
     * (specs/apple-tv-volume.md). The reading flips at once and rolls back if
     * the television refuses, so the light never claims a mute that is not
     * there. The demo build sends nothing, as with a press.
     */
    setMuted: (muted: boolean) => {
      publish({ muted });
      writeDemoAmpState<AppleTVAmpSnapshot>({ muted });
      if (DEMO_MODE) return;
      const generation = (muteGeneration += 1);
      setError(null);
      void sendAmpMute(snapshot.volume, muted).then((message) => {
        if (!message) return;
        // A later tap owns the reading now: this failure is not its answer.
        if (generation === muteGeneration) publish({ muted: !muted });
        setError(message);
      });
    },
    setVolume: (volume: number) => {
      const next = clampVolume(Math.max(0, Math.min(VOLUME_MAX, volume)));
      publish({ volume: next });
      writeDemoAmpState<AppleTVAmpSnapshot>({ volume: next });
    },
  }), [error, save, setPlaylists, state]);
}

/** The store's current value, for a component that only needs to read it once. */
export const appleTVAmpState = () => snapshot;
