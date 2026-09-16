"use client";

import type { ControlSoundSettings } from "../accentColor";
import {
  DEFAULT_UX_SOUNDS,
  REMINDER_AUDIO_SOUND,
  migrateLegacySoundId,
  type UxSoundAction,
  type UxSoundAssignments,
} from "./uxSoundActions";
import { isBuiltinSoundId, soundUrl, type SoundLibraryEntry } from "../../../lib/sound-library";

// Plays the UX sound each action is assigned in the theme. Web Audio gives
// precise control over volume and concurrency: when controls are mashed faster
// than a clip finishes, only the two newest voices keep playing and the rest
// are cancelled.
//
// The active settings (the volume and the action assignments) live in the theme
// and are pushed here by applyDeviceTheme via setActiveControlSound, so this
// module never reads the theme itself — callers just invoke playUxSound(action).
// The library of available clips is pushed separately by setSoundLibrary,
// because it lives in preferences rather than the theme.
//
// See specs/ux-sounds.md.

const MAX_CONCURRENT_VOICES = 2;
const RELEASE_SECONDS = 0.02;

type ActiveVoice = { stop: () => void };

let activeSettings: ControlSoundSettings = { volume: 60 };
let activeAssignments: UxSoundAssignments = { ...DEFAULT_UX_SOUNDS };
let libraryUrls = new Map<string, string>();
let audioContext: AudioContext | null = null;
const activeVoices: ActiveVoice[] = [];

// Decoded clips, keyed by the URL they came from, so every assigned sound stays
// latency-free rather than only the most recently used one.
const decoded = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<void>>();

/** The volume and the action assignments. */
export function setActiveControlSound(
  settings: ControlSoundSettings,
  assignments: UxSoundAssignments = DEFAULT_UX_SOUNDS,
) {
  activeSettings = settings;
  activeAssignments = assignments;
  prewarm();
}

/** The library entries available to assign, from /api/sounds. */
export function setSoundLibrary(entries: readonly SoundLibraryEntry[]) {
  libraryUrls = new Map(entries.map((entry) => [entry.id, soundUrl(entry)]));
  prewarm();
}

/** The URL of one library id, without the library loaded if it is a built-in. */
function urlForSoundId(id: string): string | null {
  const known = libraryUrls.get(id);
  if (known) {
    return known;
  }
  // Built-ins are static files at a derivable path, so they play even before
  // the library fetch lands — which is exactly when a chime tends to fire.
  return isBuiltinSoundId(id) ? `/sounds/ux/${id}.mp3` : null;
}

/**
 * The URL an assignment resolves to, or null for silence.
 *
 * A dangling id — an uploaded clip that has since been deleted — falls back to
 * the action's default rather than going silent, so removing a clip never
 * quietly kills an action (specs/ux-sounds.md).
 */
export function resolveUxSoundUrl(action: UxSoundAction): string | null {
  const assigned = activeAssignments[action] ?? null;
  if (assigned === null) {
    return null;
  }
  if (assigned === REMINDER_AUDIO_SOUND) {
    return "/api/tasks/audio";
  }

  const url = urlForSoundId(migrateLegacySoundId(assigned));
  if (url) {
    return url;
  }

  const fallback = DEFAULT_UX_SOUNDS[action];
  return fallback && fallback !== REMINDER_AUDIO_SOUND ? urlForSoundId(fallback) : null;
}

/** Decode everything currently assigned, so the first press is never swallowed. */
function prewarm() {
  if (typeof window === "undefined") {
    return;
  }
  const wanted = new Set<string>();
  for (const action of Object.keys(activeAssignments) as UxSoundAction[]) {
    const url = resolveUxSoundUrl(action);
    if (url) {
      wanted.add(url);
    }
  }
  for (const url of wanted) {
    if (!decoded.has(url) && !decoding.has(url)) {
      void decodeSource(url);
    }
  }
  // Drop clips nothing points at any more so a long session of reassignments
  // does not hold every MP3 it ever touched in memory.
  for (const url of [...decoded.keys()]) {
    if (!wanted.has(url)) {
      decoded.delete(url);
    }
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }

  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }

  // Browsers start the context suspended until a user gesture. Control presses
  // are gestures, so resuming here unlocks playback on the first tap.
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }

  return audioContext;
}

/**
 * Create and resume the context from a real gesture, so a sound that fires
 * later with no gesture of its own — a timer chime, a reminder alert — has an
 * already-running context to play into. Cheap and idempotent.
 */
export function unlockUxSound() {
  getAudioContext();
}

function decodeSource(source: string): Promise<void> {
  const existing = decoding.get(source);
  if (existing) {
    return existing;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    return Promise.resolve();
  }

  const work = (async () => {
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Sound fetch failed: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      decoded.set(source, await ctx.decodeAudioData(arrayBuffer));
    } catch {
      decoded.delete(source);
    } finally {
      decoding.delete(source);
    }
  })();

  decoding.set(source, work);
  return work;
}

function trimToNewest() {
  while (activeVoices.length > MAX_CONCURRENT_VOICES) {
    const oldest = activeVoices.shift();
    oldest?.stop();
  }
}

/** Play whatever the theme assigns to `action`. Silent when it is set to None. */
export function playUxSound(action: UxSoundAction, override?: Partial<ControlSoundSettings>) {
  const volume = override?.volume ?? activeSettings.volume;
  playSource(resolveUxSoundUrl(action), volume);
}

/** Play one specific clip, for the config page's preview buttons. */
export function previewSound(url: string | null) {
  playSource(url, activeSettings.volume);
}

function playSource(source: string | null, volume: number) {
  if (!source || volume <= 0) {
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  // Not decoded yet — the first press after an upload or an assignment change,
  // and every preview of a clip nothing is assigned to. Decode, then play the
  // same press rather than swallowing it and waiting to be asked twice.
  const buffer = decoded.get(source);
  if (!buffer) {
    void decodeSource(source).then(() => {
      const ready = decoded.get(source);
      if (ready) {
        startVoice(ctx, ready, volume);
      }
    });
    return;
  }

  startVoice(ctx, buffer, volume);
}

function startVoice(ctx: AudioContext, buffer: AudioBuffer, volume: number) {
  const now = ctx.currentTime;
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(Math.max(0.0001, volume / 100), now);

  const sourceNode = ctx.createBufferSource();
  sourceNode.buffer = buffer;
  sourceNode.connect(gainNode).connect(ctx.destination);

  let stopped = false;
  const handle: ActiveVoice = {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      const at = ctx.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(at);
        gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), at);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, at + RELEASE_SECONDS);
        sourceNode.stop(at + RELEASE_SECONDS + 0.005);
      } catch {
        // Already stopped or context closed — nothing to do.
      }
    },
  };

  sourceNode.onended = () => {
    const index = activeVoices.indexOf(handle);
    if (index >= 0) {
      activeVoices.splice(index, 1);
    }
    try {
      sourceNode.disconnect();
      gainNode.disconnect();
    } catch {
      // ignore disconnect-after-close
    }
  };

  sourceNode.start(now);

  activeVoices.push(handle);
  // Adding this voice may push the count to 3; drop the oldest so only the two
  // newest keep playing.
  trimToNewest();
}

/** The generic button click. Kept for callers that predate the action map. */
export function playControlSound(override?: Partial<ControlSoundSettings>) {
  playUxSound("buttonPress", override);
}
