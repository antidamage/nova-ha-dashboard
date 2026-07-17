"use client";

import { useSyncExternalStore } from "react";
import type { ThemeColorValue } from "./accentColor";
import type { ThemeSectionKind, ThemeSectionPayload } from "./themeSections";

// Two independent clipboards backing the editor's copy/paste:
//
//  - the *colour* clipboard holds one colour/intensity(/opacity) combo that can
//    be pasted into any colour widget; opacity rides along but is ignored by
//    widgets that have no opacity control.
//  - the *section* clipboard holds one section payload tagged with its kind, so
//    a copied map can only be pasted back into a map.
//
// State lives at module scope and is mirrored into sessionStorage so it survives
// the config editor's per-widget navigation (the editor restores its open widget
// on `pageshow`, which would otherwise wipe an in-memory clipboard).

export type ColorClipboard = {
  value: ThemeColorValue;
  opacity?: number;
};

export type SectionClipboard = {
  kind: ThemeSectionKind;
  payload: ThemeSectionPayload;
};

type ClipboardState = {
  color: ColorClipboard | null;
  section: SectionClipboard | null;
};

const STORAGE_KEY = "nova.dashboard.themeClipboard.v1";

const listeners = new Set<() => void>();
let state: ClipboardState = { color: null, section: null };
let hydrated = false;

function readStorage(): ClipboardState {
  if (typeof window === "undefined") {
    return { color: null, section: null };
  }
  try {
    const text = window.sessionStorage.getItem(STORAGE_KEY);
    if (!text) {
      return { color: null, section: null };
    }
    const parsed = JSON.parse(text) as Partial<ClipboardState>;
    return {
      color: parsed.color ?? null,
      section: parsed.section ?? null,
    };
  } catch {
    return { color: null, section: null };
  }
}

function ensureHydrated() {
  if (hydrated) {
    return;
  }
  hydrated = true;
  state = readStorage();
}

function persist() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be denied in private/restricted contexts; the in-memory copy
    // still drives the current editing session.
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: ClipboardState) {
  state = next;
  persist();
  emit();
}

export function copyColorToClipboard(value: ColorClipboard) {
  ensureHydrated();
  setState({ ...state, color: { value: structuredClone(value.value), opacity: value.opacity } });
}

export function copySectionToClipboard(value: SectionClipboard) {
  ensureHydrated();
  setState({ ...state, section: { kind: value.kind, payload: structuredClone(value.payload) } });
}

function subscribe(listener: () => void) {
  ensureHydrated();
  listeners.add(listener);

  // A clipboard copied in another tab should appear here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      state = readStorage();
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function getSnapshot(): ClipboardState {
  ensureHydrated();
  return state;
}

const SERVER_SNAPSHOT: ClipboardState = { color: null, section: null };

export function useThemeClipboard() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
