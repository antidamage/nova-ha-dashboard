"use client";

import type { ControlSoundSettings } from "../accentColor";

// Plays the user-uploaded UI sound (a data URL stored in the theme) when a
// control button commands a device. Web Audio gives precise control over volume
// and concurrency: when controls are mashed faster than the clip finishes, only
// the two newest voices keep playing and the rest are cancelled.
//
// The active settings (uploaded source + volume) live in the theme and are pushed
// here by applyDeviceTheme via setActiveControlSound, so this module never reads
// the theme itself — callers just invoke playControlSound().

const MAX_CONCURRENT_VOICES = 2;
const RELEASE_SECONDS = 0.02;

type ActiveVoice = { stop: () => void };

let activeSettings: ControlSoundSettings = { name: null, source: null, volume: 60 };
let audioContext: AudioContext | null = null;
const activeVoices: ActiveVoice[] = [];

// Decode the uploaded clip once and cache it, keyed by the data URL, so each
// press is latency-free. Re-decoded whenever the source changes.
let decodedSource: string | null = null;
let decodedBuffer: AudioBuffer | null = null;
let decodingSource: string | null = null;

export function setActiveControlSound(settings: ControlSoundSettings) {
  activeSettings = settings;

  if (!settings.source) {
    decodedSource = null;
    decodedBuffer = null;
    return;
  }

  // Pre-decode the new clip so the first press plays immediately.
  if (settings.source !== decodedSource && settings.source !== decodingSource) {
    void decodeSource(settings.source);
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

  decodingSource = source;
  try {
    const response = await fetch(source);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    if (activeSettings.source === source) {
      decodedSource = source;
      decodedBuffer = buffer;
    }
  } catch {
    if (activeSettings.source === source) {
      decodedSource = null;
      decodedBuffer = null;
    }
  } finally {
    if (decodingSource === source) {
      decodingSource = null;
    }
  }
}

function trimToNewest() {
  while (activeVoices.length > MAX_CONCURRENT_VOICES) {
    const oldest = activeVoices.shift();
    oldest?.stop();
  }
}

export function playControlSound(override?: Partial<ControlSoundSettings>) {
  const settings = override ? { ...activeSettings, ...override } : activeSettings;
  if (!settings.source || settings.volume <= 0) {
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  // Not decoded yet (e.g. first press right after upload) — kick off the decode
  // so the next press has it, and skip this one rather than blocking.
  if (decodedSource !== settings.source || !decodedBuffer) {
    void decodeSource(settings.source);
    return;
  }

  const now = ctx.currentTime;
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(Math.max(0.0001, settings.volume / 100), now);

  const sourceNode = ctx.createBufferSource();
  sourceNode.buffer = decodedBuffer;
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
