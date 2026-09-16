"use client";

// Sole owner of module-level state and localStorage in theme/accent: theme
// pins, override key, theme caches, the debounced shared-theme write queue.
import { isControlInteractionCoolingDown, markControlInteraction } from "../../controlInteractionCooldown";
import { applyDeviceTheme } from "./apply";
import { writeSharedTheme } from "./client";
import { cookieValue, writeThemeCookie, writeThemeScopeCookie } from "./cookies";
import {
  DEFAULT_THEME_SCOPE,
  HOUSE_PARTY_THEME_OVERRIDE_EVENT,
  SHARED_THEME_STORAGE_KEY,
  SHARED_THEME_WRITE_DEBOUNCE_MS,
  SHARED_THEME_WRITE_RETRY_MS,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_STORAGE_KEY,
  THEME_SCOPE_COOKIE_NAME,
  THEME_SCOPE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
import { DEFAULT_THEME_SET } from "./defaults";
import { normalizeThemeScope } from "./normalize-model";
import { normalizeTheme, normalizeThemeSet } from "./theme-model";
import { normalizeThemeOverride, resolveDeviceTheme } from "./variant-model";
import type { DeviceTheme, DeviceThemeSet, ThemeConfigScope, ThemeOverride, ThemeStorageValue, ThemeVariant } from "./types";

// After the user edits a theme value (e.g. dragging a colour spectrum or an
// intensity/opacity slider) we hold off the background shared-theme refresh for
// this long. The 30s poll fetches /api/theme over the network, and until the
// debounced write below has landed that response still carries the pre-edit
// colour — applying it mid-drag snapped the swatch back (the "colour"
// rubber-band). Six seconds comfortably covers the debounced write plus the
// server round-trip, matching the config-side useSettingCooldown contract.
export function pauseThemePolling() {
  markControlInteraction();
}
export function isThemePollingPaused() {
  return isControlInteractionCoolingDown();
}

export function readThemeOverride(): ThemeOverride {
  if (typeof window === "undefined") return "unset";
  try {
    return normalizeThemeOverride(window.localStorage.getItem(THEME_OVERRIDE_STORAGE_KEY));
  } catch {
    return "unset";
  }
}

export function writeThemeOverride(next: ThemeOverride) {
  if (typeof window === "undefined") return;
  const normalized = normalizeThemeOverride(next);
  try {
    if (normalized === "unset") {
      window.localStorage.removeItem(THEME_OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_OVERRIDE_STORAGE_KEY, normalized);
    }
  } catch {
    // Storage blocked: the change still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(THEME_OVERRIDE_CHANGE_EVENT, { detail: normalized }));
}

// While the theme config editor is open it pins :root to the variant being edited
// (the light/dark tab), regardless of the active selection. Without this, the
// shared-theme poll and sun-change events inside useDeviceTheme keep re-applying
// the *selection-resolved* variant to the document, fighting the editor — which is
// what made panel backgrounds, title colours, etc. flicker between the variant
// being edited and the dashboard's active one. When an override is set, applyThemeSet
// applies it instead of the resolved theme; clearing it restores the active theme.
export let documentThemeOverride: DeviceTheme | null = null;
export let housePartyThemeOverride: DeviceTheme | null = null;
let lastResolvedDocumentTheme: DeviceTheme | null = null;
let lastResolvedDocumentVariant: ThemeVariant | null = null;

// data-theme-variant on :root names the variant actually painted. House party
// blends from the resolved variant, so it keeps it; the config editor's pin
// paints an arbitrary edited theme, so no variant applies while it is set.
export function syncThemeVariantAttribute() {
  if (typeof document === "undefined") return;
  if (documentThemeOverride || !lastResolvedDocumentVariant) {
    delete document.documentElement.dataset.themeVariant;
  } else {
    document.documentElement.dataset.themeVariant = lastResolvedDocumentVariant;
  }
}

export function setHousePartyThemeOverride(theme: DeviceTheme | null) {
  housePartyThemeOverride = theme ? normalizeTheme(theme) : null;
  const next =
    documentThemeOverride ??
    housePartyThemeOverride ??
    lastResolvedDocumentTheme ??
    resolveDeviceTheme(normalizeThemeSet(DEFAULT_THEME_SET)).theme;
  applyDeviceTheme(next);
  syncThemeVariantAttribute();
  window.dispatchEvent(new CustomEvent(HOUSE_PARTY_THEME_OVERRIDE_EVENT, {
    detail: housePartyThemeOverride,
  }));
}

export function setDocumentThemeOverride(theme: DeviceTheme | null) {
  documentThemeOverride = theme ? normalizeTheme(theme) : null;
  const next =
    documentThemeOverride ??
    housePartyThemeOverride ??
    lastResolvedDocumentTheme ??
    resolveDeviceTheme(normalizeThemeSet(DEFAULT_THEME_SET)).theme;
  applyDeviceTheme(next);
  syncThemeVariantAttribute();
}

export function readThemeScope() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_SCOPE;
  }

  try {
    return normalizeThemeScope(window.localStorage.getItem(THEME_SCOPE_STORAGE_KEY) ?? cookieValue(THEME_SCOPE_COOKIE_NAME));
  } catch {
    return normalizeThemeScope(cookieValue(THEME_SCOPE_COOKIE_NAME));
  }
}

export function writeThemeScope(scope: ThemeConfigScope) {
  const normalized = normalizeThemeScope(scope);
  window.localStorage.setItem(THEME_SCOPE_STORAGE_KEY, normalized);
  writeThemeScopeCookie(normalized);
}

function readStoredThemeValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const text = window.localStorage.getItem(key);
    return text ? JSON.parse(text) as ThemeStorageValue : null;
  } catch {
    return null;
  }
}

export function readLocalThemeSet(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  if (typeof window === "undefined") {
    return normalizeThemeSet(fallback);
  }

  return normalizeThemeSet(readStoredThemeValue(THEME_STORAGE_KEY) ?? fallback, fallback);
}

export function hasSharedThemeCache() {
  return readStoredThemeValue(SHARED_THEME_STORAGE_KEY) !== null;
}

export function readSharedThemeSetFromStorage(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  return normalizeThemeSet(readStoredThemeValue(SHARED_THEME_STORAGE_KEY) ?? fallback, fallback);
}

export function writeLocalTheme(themeSet: DeviceThemeSet) {
  const normalized = normalizeThemeSet(themeSet);
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized));
  writeThemeCookie(normalized);
}

export function writeSharedThemeCache(themeSet: DeviceThemeSet) {
  const normalized = normalizeThemeSet(themeSet);
  window.localStorage.setItem(SHARED_THEME_STORAGE_KEY, JSON.stringify(normalized));
}

let pendingSharedThemeWrite: DeviceThemeSet | null = null;
let sharedThemeWriteInFlight = false;
let sharedThemeWriteTimer: number | null = null;
let nextThemeHookInstanceId = 1;

function queueSharedThemeFlush(delay = SHARED_THEME_WRITE_DEBOUNCE_MS) {
  if (typeof window === "undefined") {
    return;
  }

  if (sharedThemeWriteTimer !== null) {
    window.clearTimeout(sharedThemeWriteTimer);
  }

  sharedThemeWriteTimer = window.setTimeout(() => {
    sharedThemeWriteTimer = null;
    flushSharedThemeWrite();
  }, delay);
}

function flushSharedThemeWrite() {
  if (sharedThemeWriteInFlight || !pendingSharedThemeWrite) {
    return;
  }

  const nextThemeSet = pendingSharedThemeWrite;
  pendingSharedThemeWrite = null;
  sharedThemeWriteInFlight = true;
  let retryDelay = SHARED_THEME_WRITE_DEBOUNCE_MS;

  void writeSharedTheme(nextThemeSet)
    .then((persistedThemeSet) => {
      if (!pendingSharedThemeWrite) {
        writeSharedThemeCache(persistedThemeSet);
      }
    })
    .catch((error) => {
      console.error("[nova-dashboard] failed to update shared dashboard theme", error);
      // Never discard the user's newest local choice on a transient write
      // failure. Keep it authoritative, retry it, and extend the poll hold so a
      // 30s GET cannot reapply the older server copy in the meantime.
      pendingSharedThemeWrite ??= nextThemeSet;
      retryDelay = SHARED_THEME_WRITE_RETRY_MS;
      pauseThemePolling();
    })
    .finally(() => {
      sharedThemeWriteInFlight = false;
      if (pendingSharedThemeWrite) {
        queueSharedThemeFlush(retryDelay);
      }
    });
}

/**
 * Write any debounced shared-theme edit out now and wait for the queue to
 * drain. Callers that act on the *server's* copy of the theme (the managed
 * desktop wallpaper push, which reads preferences server-side) need the newest
 * selection to have landed before they fire, otherwise they push the previous
 * wallpaper. Gives up after `timeoutMs` rather than blocking the UI on a write
 * that keeps failing and retrying — the pending value is still retried in the
 * background.
 */
export async function flushPendingSharedThemeWrite(timeoutMs = 5000): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  if (sharedThemeWriteTimer !== null) {
    window.clearTimeout(sharedThemeWriteTimer);
    sharedThemeWriteTimer = null;
  }
  flushSharedThemeWrite();

  const deadline = Date.now() + timeoutMs;
  while ((sharedThemeWriteInFlight || pendingSharedThemeWrite) && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    if (!sharedThemeWriteInFlight && pendingSharedThemeWrite) {
      // A queued retry is waiting on its timer; run it immediately.
      if (sharedThemeWriteTimer !== null) {
        window.clearTimeout(sharedThemeWriteTimer);
        sharedThemeWriteTimer = null;
      }
      flushSharedThemeWrite();
    }
  }
}

export function scheduleSharedThemeWrite(themeSet: DeviceThemeSet) {
  pendingSharedThemeWrite = normalizeThemeSet(themeSet);
  queueSharedThemeFlush();
}

// For useDeviceTheme.ts, which assigned these directly before the split; an
// ES module cannot assign another module's binding.
export function takeNextThemeHookInstanceId() {
  return nextThemeHookInstanceId++;
}

export function setLastResolvedDocumentTheme(theme: DeviceTheme | null) {
  lastResolvedDocumentTheme = theme;
}

export function setLastResolvedDocumentVariant(variant: ThemeVariant | null) {
  lastResolvedDocumentVariant = variant;
}

export function removeLocalTheme() {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
}
