"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyDeviceTheme } from "./apply";
import { readSharedThemeSet, readSunStatus } from "./client";
import { writeThemeCookie, writeThemeScopeCookie } from "./cookies";
import { DEFAULT_THEME_SCOPE, NOVA_THEME_SET_CHANGE_EVENT, THEME_CHANGE_EVENT } from "./constants";
import { DEFAULT_THEME_SET } from "./defaults";
import { normalizeThemeScope } from "./normalize-model";
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
  scheduleSharedThemeWrite,
  setLastResolvedDocumentTheme,
  setLastResolvedDocumentVariant,
  syncThemeVariantAttribute,
  takeNextThemeHookInstanceId,
  writeLocalTheme,
  writeSharedThemeCache,
} from "./store";
import { normalizeThemeSet } from "./theme-model";
import { useThemeSetters } from "./useThemeSetters";
import { useThemeSync } from "./useThemeSync";
import { effectiveThemeSelection, resolveDeviceTheme, resolveThemeVariant } from "./variant-model";
import type {
  DeviceTheme,
  SunThemeStatus,
  ThemeConfigScope,
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

  useThemeSync({
    applyThemeSet,
    instanceIdRef,
    loadTheme,
    setRuntimeThemeOverride,
    setThemeReady,
    sunStatusRef,
    themeScope,
    themeScopeRef,
    themeSetRef,
  });

  const {
    resetTheme,
    setTheme,
    setThemeColor,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
  } = useThemeSetters({
    activeVariantRef,
    applyThemeSet,
    loadTheme,
    setThemeReady,
    setThemeScopeState,
    sunStatusRef,
    themeRef,
    themeScopeRef,
    themeSetRef,
  });

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
