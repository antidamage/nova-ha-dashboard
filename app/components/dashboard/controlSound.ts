"use client";

import type { ControlSoundSettings } from "../accentColor";
import {
  BUTTON_PRESS_SOUND,
  DEFAULT_UX_SOUNDS,
  REMINDER_AUDIO_SOUND,
  TIMER_CHIME_SOUND,
  type UxSoundAction,
  type UxSoundAssignments,
} from "./uxSoundActions";
import { soundUrl, type SoundLibraryEntry } from "../../../lib/sound-library";

// Plays the UX sound each action is assigned in the theme. Web Audio gives
// precise control over volume and concurrency: when controls are mashed faster
// than a clip finishes, only the two newest voices keep playing and the rest
// are cancelled.
//
// The active settings (the theme's own uploaded clip, the action assignments
// and the timer chime choice) live in the theme and are pushed here by
// applyDeviceTheme via setActiveControlSound, so this module never reads the
// theme itself — callers just invoke playUxSound(action). The library of
// available clips is pushed separately by setSoundLibrary, because it lives in
// preferences rather than the theme.
//
// See specs/ux-sounds.md.

const MAX_CONCURRENT_VOICES = 2;
const RELEASE_SECONDS = 0.02;

type ActiveVoice = { stop: () => void };

let activeSettings: ControlSoundSettings = { name: null, source: null, volume: 60 };
let activeAssignments: UxSoundAssignments = { ...DEFAULT_UX_SOUNDS };
let activeTimerSound = "Chime";
let libraryUrls = new Map<string, string>();
let audioContext: AudioContext | null = null;
const activeVoices: ActiveVoice[] = [];

// Decoded clips, keyed by the URL they came from, so every assigned sound stays
// latency-free rather than only the most recently used one.
const decoded = new Map<string, AudioBuffer>();
const decoding = new Set<string>();

/** The theme's own clip, the action assignments, and the timer chime choice. */
export function setActiveControlSound(
  settings: ControlSoundSettings,
  assignments: UxSoundAssignments = DEFAULT_UX_SOUNDS,
  timerSound = "Chime",
) {
  activeSettings = settings;
  activeAssignments = assignments;
  activeTimerSound = timerSound;
  prewarm();
}

/** The library entries available to assign, from /api/sounds. */
export function setSoundLibrary(entries: readonly SoundLibraryEntry[]) {
  libraryUrls = new Map(entries.map((entry) => [entry.id, soundUrl(entry)]));
  prewarm();
}

/**
 * The URL an assignment resolves to, or null for silence.
 *
 * A dangling id — a clip that has since been deleted — falls back to the
 * theme's own sound rather than going silent, so removing a clip never quietly
 * kills an action (specs/ux-sounds.md).
 */
export function resolveUxSoundUrl(action: UxSoundAction): string | null {
  const assigned = activeAssignments[action] ?? null;
  if (assigned === null) {
    return null;
  }
  if (assigned === TIMER_CHIME_SOUND) {
    return `/sounds/timer-${activeTimerSound.toLowerCase().replaceAll(" ", "-")}.mp3`;
  }
  if (assigned === REMINDER_AUDIO_SOUND) {
    return "/api/tasks/audio";
  }
  if (assigned !== BUTTON_PRESS_SOUND) {
    const url = libraryUrls.get(assigned);
    if (url) {
      return url;
    }
  }
  return activeSettings.source;
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

async function decodeSource(source: string) {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  decoding.add(source);
  try {
    const response = await fetch(source);
    const arrayBuffer = await response.arrayBuffer();
    decoded.set(source, await ctx.decodeAudioData(arrayBuffer));
  } catch {
    decoded.delete(source);
  } finally {
    decoding.delete(source);
  }
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
  const source = override && "source" in override ? override.source ?? null : resolveUxSoundUrl(action);
  playSource(source, volume);
}

/** Play one specific clip, for the config page's preview buttons. */
export function previewSound(url: string) {
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

  // Not decoded yet (e.g. first press right after an upload) — kick off the
  // decode so the next press has it, and skip this one rather than blocking.
  const buffer = decoded.get(source);
  if (!buffer) {
    if (!decoding.has(source)) {
      void decodeSource(source);
    }
    return;
  }

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
