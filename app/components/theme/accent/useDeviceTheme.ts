"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyDeviceTheme } from "./apply";
import { readSharedThemeSet, readSunStatus } from "./client";
import { removeThemeCookie, writeThemeCookie, writeThemeScopeCookie } from "./cookies";
import {
  DEFAULT_THEME_SCOPE,
  HOUSE_PARTY_THEME_OVERRIDE_EVENT,
  NOVA_THEME_SET_CHANGE_EVENT,
  SHARED_THEME_POLL_MS,
  SHARED_THEME_STORAGE_KEY,
  SUN_CHANGE_EVENT,
  THEME_CHANGE_EVENT,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_STORAGE_KEY,
  THEME_SCOPE_CHANGE_EVENT,
  THEME_SCOPE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
import { DEFAULT_THEME_SET } from "./defaults";
import { normalizeThemeScope, normalizeThemeSelection, normalizeThemeVariant, recordValue } from "./normalize-model";
import {
  documentThemeOverride,
  hasSharedThemeCache,
  housePartyThemeOverride,
  isThemePollingPaused,
  pauseThemePolling,
  readLocalThemeSet,
  readSharedThemeSetFromStorage,
  readThemeOverride,
  readThemeScope,
  removeLocalTheme,
  scheduleSharedThemeWrite,
  setLastResolvedDocumentTheme,
  setLastResolvedDocumentVariant,
  syncThemeVariantAttribute,
  takeNextThemeHookInstanceId,
  writeLocalTheme,
  writeSharedThemeCache,
  writeThemeScope,
} from "./store";
import { normalizeTheme, normalizeThemeSet } from "./theme-model";
import { effectiveThemeSelection, resolveDeviceTheme, resolveThemeVariant } from "./variant-model";
import type {
  DeviceTheme,
  SunThemeStatus,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeConfigScope,
  ThemeSelection,
  ThemeSource,
  ThemeStorageValue,
  ThemeVariant,
} from "./types";

function initialThemeState(initialTheme: ThemeStorageValue | null | undefined) {
  const scope = readThemeScope();
  if (initialTheme != null) {
    return {
      ready: true,
      source: "initial-prop" as ThemeSource,
      scope,
      themeSet: normalizeThemeSet(initialTheme),
    };
  }

  if (scope === "shared") {
    const hasCache = hasSharedThemeCache();
    return {
      ready: hasCache,
      source: hasCache ? "shared-cache" as ThemeSource : "default" as ThemeSource,
      scope,
      themeSet: readSharedThemeSetFromStorage(DEFAULT_THEME_SET),
    };
  }

  return {
    ready: true,
    source: "local-storage" as ThemeSource,
    scope,
    themeSet: readLocalThemeSet(DEFAULT_THEME_SET),
  };
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useDeviceTheme(initialTheme?: ThemeStorageValue | null, initialSun?: SunThemeStatus | null) {
  const instanceIdRef = useRef(0);
  if (instanceIdRef.current === 0) {
    instanceIdRef.current = takeNextThemeHookInstanceId();
  }

  const initialStateRef = useRef<ReturnType<typeof initialThemeState> | null>(null);
  if (initialStateRef.current === null) {
    initialStateRef.current = initialThemeState(initialTheme);
  }

  const [themeScope, setThemeScopeState] = useState<ThemeConfigScope>(() => initialStateRef.current?.scope ?? DEFAULT_THEME_SCOPE);
  const [themeSet, setThemeSetState] = useState(() => initialStateRef.current?.themeSet ?? normalizeThemeSet(DEFAULT_THEME_SET));
  // Resolve the first render's variant with the server-known sun status when
  // the caller has one — an "auto" selection resolved sunless falls back to an
  // hour-of-day guess, which paints the wrong variant's colours on first load
  // (and during SSR the guess runs on the server clock/timezone).
  const initialResolvedTheme = resolveDeviceTheme(
    initialStateRef.current?.themeSet ?? normalizeThemeSet(DEFAULT_THEME_SET),
    initialSun ?? null,
  );
  const [activeVariant, setActiveVariant] = useState<ThemeVariant>(initialResolvedTheme.activeVariant);
  // The variant the global selection resolves to, ignoring this device's
  // override — what the config editor opens on.
  const [globalVariant, setGlobalVariant] = useState<ThemeVariant>(initialResolvedTheme.activeVariant);
  const [theme, setThemeState] = useState(() => initialResolvedTheme.theme);
  const [runtimeThemeOverride, setRuntimeThemeOverride] = useState<DeviceTheme | null>(() => housePartyThemeOverride);
  const [themeReady, setThemeReady] = useState(initialStateRef.current?.ready ?? false);
  const [themeSource, setThemeSource] = useState<ThemeSource>(initialStateRef.current?.source ?? "default");
  const themeScopeRef = useRef(themeScope);
  const themeSetRef = useRef(themeSet);
  const themeRef = useRef(theme);
  const activeVariantRef = useRef(activeVariant);
  const sunStatusRef = useRef<SunThemeStatus | null>(initialSun ?? null);

  const applyThemeSet = useCallback((
    value: ThemeStorageValue | null | undefined,
    options: {
      broadcast?: boolean;
      persist?: boolean;
      source?: ThemeSource;
      sun?: SunThemeStatus | null;
    } = {},
  ) => {
    const normalized = normalizeThemeSet(value, DEFAULT_THEME_SET);
    const sun = options.sun === undefined ? sunStatusRef.current : options.sun;
    const resolved = resolveDeviceTheme(normalized, sun, readThemeOverride());
    const source = options.source;

    themeSetRef.current = normalized;
    themeRef.current = resolved.theme;
    activeVariantRef.current = resolved.activeVariant;
    setThemeSetState(normalized);
    setThemeState(resolved.theme);
    setActiveVariant(resolved.activeVariant);
    if (source) {
      setThemeSource(source);
    }
    setLastResolvedDocumentTheme(resolved.theme);
    applyDeviceTheme(documentThemeOverride ?? housePartyThemeOverride ?? resolved.theme);
    setLastResolvedDocumentVariant(resolved.activeVariant);
    syncThemeVariantAttribute();
    setGlobalVariant(resolveThemeVariant(normalized.selection, sun));
    writeThemeCookie(normalized);

    if (options.persist) {
      // A user edit: suppress the background shared-theme poll for a few seconds
      // so an in-flight fetch can't overwrite the value being adjusted.
      pauseThemePolling();
      if (themeScopeRef.current === "shared") {
        writeSharedThemeCache(normalized);
        scheduleSharedThemeWrite(normalized);
      } else {
        writeLocalTheme(normalized);
      }
    }

    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));

    if (options.broadcast !== false) {
      window.dispatchEvent(new CustomEvent(NOVA_THEME_SET_CHANGE_EVENT, {
        detail: {
          originId: instanceIdRef.current,
          scope: themeScopeRef.current,
          source,
          sun,
          themeSet: normalized,
        },
      }));
    }
  }, []);

  const loadTheme = useCallback(async (
    requestedScope: ThemeConfigScope = readThemeScope(),
    options: { background?: boolean } = {},
  ) => {
    if (options.background && isThemePollingPaused()) {
      return;
    }
    const nextScope = normalizeThemeScope(requestedScope);
    const fallback = initialTheme ?? DEFAULT_THEME_SET;
    themeScopeRef.current = nextScope;
    setThemeScopeState(nextScope);

    try {
      const nextThemeSet = nextScope === "shared"
        ? await readSharedThemeSet(fallback)
        : readLocalThemeSet(fallback);
      const source: ThemeSource = nextScope === "shared" ? "api-theme" : "local-storage";
      if (options.background && isThemePollingPaused()) {
        setThemeReady(true);
        return;
      }
      const nextSun = effectiveThemeSelection(nextThemeSet.selection, readThemeOverride()) === "auto"
        ? await readSunStatus().catch(() => sunStatusRef.current)
        : sunStatusRef.current;

      // A background poll whose fetch was already in flight when the user started
      // editing must not clobber the in-progress edit — skip applying the value
      // we just read (the debounced write reconciles the server and cache).
      if (options.background && isThemePollingPaused()) {
        setThemeReady(true);
        return;
      }

      if (nextScope === "shared") {
        writeSharedThemeCache(nextThemeSet);
      }
      sunStatusRef.current = nextSun;
      applyThemeSet(nextThemeSet, { source, sun: nextSun });
      writeThemeScopeCookie(nextScope);
      setThemeReady(true);
    } catch (error) {
      console.error("[nova-dashboard] failed to load dashboard theme", error);
      setThemeReady(true);
    }
  }, [applyThemeSet, initialTheme]);

  // SSR and hydration render the global selection; a stored per-device
  // override is applied in a layout effect so it lands before the first paint
  // after hydration instead of flashing the global variant.
  useIsomorphicLayoutEffect(() => {
    if (readThemeOverride() !== "unset") {
      applyThemeSet(themeSetRef.current, { broadcast: false });
    }
  }, [applyThemeSet]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_OVERRIDE_STORAGE_KEY) {
        onOverrideChange();
        return;
      }
      if (event.key === null) {
        // Storage cleared in another tab: the override key went with it.
        onOverrideChange();
      }
      if (
        event.key &&
        event.key !== THEME_STORAGE_KEY &&
        event.key !== THEME_SCOPE_STORAGE_KEY &&
        event.key !== SHARED_THEME_STORAGE_KEY
      ) {
        return;
      }

      if (isThemePollingPaused()) {
        return;
      }

      void loadTheme();
    };
    const onScopeChange = () => void loadTheme();
    const onOverrideChange = () => {
      if (effectiveThemeSelection(themeSetRef.current.selection, readThemeOverride()) !== "auto") {
        applyThemeSet(themeSetRef.current, { broadcast: false });
        return;
      }
      void readSunStatus()
        .then((nextSun) => {
          sunStatusRef.current = nextSun;
          applyThemeSet(themeSetRef.current, { broadcast: false, sun: nextSun });
        })
        .catch(() => applyThemeSet(themeSetRef.current, { broadcast: false }));
    };
    const onThemeSetChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = recordValue(event.detail);
      const themeSetDetail = detail?.themeSet ?? (detail?.themes ? detail : null);
      if (!detail || !themeSetDetail || Number(detail.originId) === instanceIdRef.current) {
        return;
      }

      const eventScope = normalizeThemeScope(detail.scope ?? themeScopeRef.current);
      if (eventScope !== themeScopeRef.current) {
        return;
      }

      const nextSun = Object.hasOwn(detail, "sun")
        ? detail.sun as SunThemeStatus | null
        : sunStatusRef.current;
      sunStatusRef.current = nextSun;
      applyThemeSet(themeSetDetail as ThemeStorageValue, { broadcast: false, source: "event", sun: nextSun });
      setThemeReady(true);
    };
    const onSunChange = (event: Event) => {
      if (isThemePollingPaused()) {
        return;
      }
      const nextSun = event instanceof CustomEvent ? event.detail as SunThemeStatus | null : null;
      sunStatusRef.current = nextSun;
      if (effectiveThemeSelection(themeSetRef.current.selection, readThemeOverride()) === "auto") {
        applyThemeSet(themeSetRef.current, { sun: nextSun });
      }
    };
    const onHousePartyThemeOverride = (event: Event) => {
      setRuntimeThemeOverride(
        event instanceof CustomEvent && event.detail
          ? normalizeTheme(event.detail as DeviceTheme)
          : null,
      );
    };

    void loadTheme();
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
    window.addEventListener(THEME_OVERRIDE_CHANGE_EVENT, onOverrideChange);
    window.addEventListener(NOVA_THEME_SET_CHANGE_EVENT, onThemeSetChange);
    window.addEventListener(SUN_CHANGE_EVENT, onSunChange);
    window.addEventListener(HOUSE_PARTY_THEME_OVERRIDE_EVENT, onHousePartyThemeOverride);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
      window.removeEventListener(THEME_OVERRIDE_CHANGE_EVENT, onOverrideChange);
      window.removeEventListener(NOVA_THEME_SET_CHANGE_EVENT, onThemeSetChange);
      window.removeEventListener(SUN_CHANGE_EVENT, onSunChange);
      window.removeEventListener(HOUSE_PARTY_THEME_OVERRIDE_EVENT, onHousePartyThemeOverride);
    };
  }, [applyThemeSet, loadTheme]);

  useEffect(() => {
    if (themeScope !== "shared") {
      return;
    }

    const interval = window.setInterval(() => {
      // Don't poll over the top of a value the user is actively editing.
      if (isThemePollingPaused()) {
        return;
      }
      void loadTheme("shared", { background: true });
    }, SHARED_THEME_POLL_MS);

    return () => window.clearInterval(interval);
  }, [loadTheme, themeScope]);

  const setTheme = useCallback((next: DeviceTheme, options: { persist?: boolean } = {}) => {
    const normalized = normalizeTheme(next);
    applyThemeSet({
      ...themeSetRef.current,
      themes: {
        ...themeSetRef.current.themes,
        [activeVariantRef.current]: normalized,
      },
    }, { persist: options.persist ?? true, source: "set" });
  }, [applyThemeSet]);

  const setThemeVariant = useCallback((variant: ThemeVariant, next: DeviceTheme, options: { persist?: boolean } = {}) => {
    const normalizedVariant = normalizeThemeVariant(variant);
    applyThemeSet({
      ...themeSetRef.current,
      themes: {
        ...themeSetRef.current.themes,
        [normalizedVariant]: normalizeTheme(next),
      },
    }, { persist: options.persist ?? true, source: "set" });
  }, [applyThemeSet]);

  const setThemeSet = useCallback((next: ThemeStorageValue) => {
    applyThemeSet(next, { persist: true, source: "set" });
  }, [applyThemeSet]);

  const setThemeSelection = useCallback((
    nextSelection: ThemeSelection,
    options: { persist?: boolean } = {},
  ) => {
    const selection = normalizeThemeSelection(nextSelection);
    const nextThemeSet = {
      ...themeSetRef.current,
      selection,
    };

    const persist = options.persist ?? true;
    if (selection !== "auto" || !persist) {
      applyThemeSet(nextThemeSet, { persist, source: "set" });
      return;
    }

    void readSunStatus()
      .then((nextSun) => {
        sunStatusRef.current = nextSun;
        applyThemeSet(nextThemeSet, { persist: true, source: "set", sun: nextSun });
      })
      .catch(() => applyThemeSet(nextThemeSet, { persist: true, source: "set" }));
  }, [applyThemeSet]);

  const setThemeScope = useCallback((nextScope: ThemeConfigScope) => {
    const normalized = normalizeThemeScope(nextScope);
    writeThemeScope(normalized);
    themeScopeRef.current = normalized;
    setThemeScopeState(normalized);
    window.dispatchEvent(new CustomEvent(THEME_SCOPE_CHANGE_EVENT));
    void loadTheme(normalized);
  }, [loadTheme]);

  const setThemeColor = useCallback(
    (slot: ThemeColorSlot | "background", value: ThemeColorValue) => {
      setTheme({ ...themeRef.current, [slot]: value });
    },
    [setTheme],
  );

  const resetTheme = useCallback(() => {
    const nextThemeSet = normalizeThemeSet(DEFAULT_THEME_SET);

    setThemeReady(true);

    if (themeScopeRef.current === "shared") {
      applyThemeSet(nextThemeSet, { persist: true, source: "set" });
      return;
    }

    applyThemeSet(nextThemeSet, { source: "set" });
    removeLocalTheme();
    removeThemeCookie();
  }, [applyThemeSet]);

  return {
    activeVariant,
    globalVariant,
    resetTheme,
    setTheme,
    setThemeColor,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
    configuredTheme: theme,
    theme: runtimeThemeOverride ?? theme,
    themeReady,
    themeScope,
    themeSource,
    themeSet,
  };
}
