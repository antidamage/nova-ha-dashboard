// Host-backed library of named voice personalities. Mirrors the theme library
// (lib/theme-library.ts): this module is free of React/DOM so it runs in both
// the API route and the browser. Each entry's `personality` is deep-normalized
// via `normalizeVoicePersonalitySet`, reusing the exact field validation the
// live voice settings use.

import {
  normalizeVoicePersonalitySet,
  type VoiceEngine,
  type VoicePersonalitySet,
} from "./voice-settings";

export const VOICE_PERSONALITY_LIBRARY_VERSION = 1;
export const VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES = 100;
export const VOICE_PERSONALITY_LIBRARY_MAX_NAME_LENGTH = 60;

export type VoicePersonalityLibraryEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  personality: VoicePersonalitySet;
  // Which TTS engine this profile is for. Stamped from the active engine when
  // the profile is saved; the Voice Agent picker only lists profiles for the
  // engine currently loaded. Undefined = a legacy profile saved before engines
  // were tracked; those stay visible under any engine until re-saved.
  engine?: VoiceEngine;
};

export type VoicePersonalityLibrary = {
  version: number;
  activeId: string | null;
  entries: VoicePersonalityLibraryEntry[];
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
  return text.slice(0, VOICE_PERSONALITY_LIBRARY_MAX_NAME_LENGTH);
}

/**
 * A reasonably-unique id that works without crypto in any runtime. Library
 * entries are low-volume and user-named, so collision resistance only needs to
 * be good enough to avoid clashes within a single session.
 */
export function createVoicePersonalityId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `persona_${Date.now().toString(36)}_${random}`;
}

export function emptyVoicePersonalityLibrary(): VoicePersonalityLibrary {
  return { version: VOICE_PERSONALITY_LIBRARY_VERSION, activeId: null, entries: [] };
}

export function normalizeVoicePersonalityLibrary(value: unknown): VoicePersonalityLibrary {
  const record = recordValue(value);
  if (!record) {
    return emptyVoicePersonalityLibrary();
  }

  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const seenIds = new Set<string>();
  const entries: VoicePersonalityLibraryEntry[] = [];

  for (const raw of rawEntries) {
    if (entries.length >= VOICE_PERSONALITY_LIBRARY_MAX_ENTRIES) {
      break;
    }

    const entry = recordValue(raw);
    if (!entry) {
      continue;
    }

    let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createVoicePersonalityId();
    while (seenIds.has(id)) {
      id = createVoicePersonalityId();
    }
    seenIds.add(id);

    const createdAt = isoStringOr(entry.createdAt, new Date().toISOString());
    entries.push({
      id,
      name: trimmedName(entry.name, "Untitled personality"),
      createdAt,
      updatedAt: isoStringOr(entry.updatedAt, createdAt),
      // Missing/invalid fields fall back to the settings defaults, so a
      // partially-shaped entry is repaired rather than dropped.
      personality: normalizeVoicePersonalitySet(entry.personality),
      // Preserve an explicit engine tag; leave undefined for legacy profiles
      // (they stay visible under any engine until re-saved).
      ...(entry.engine === "classic" || entry.engine === "custom"
        ? { engine: entry.engine }
        : {}),
    });
  }

  const activeId = typeof record.activeId === "string" && seenIds.has(record.activeId)
    ? record.activeId
    : null;

  return { version: VOICE_PERSONALITY_LIBRARY_VERSION, activeId, entries };
}
