"use client";

import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { readSunStatus } from "./client";
import { removeThemeCookie } from "./cookies";
import { THEME_SCOPE_CHANGE_EVENT } from "./constants";
import { DEFAULT_THEME_SET } from "./defaults";
import { normalizeThemeScope, normalizeThemeSelection, normalizeThemeVariant } from "./normalize-model";
import { removeLocalTheme, writeThemeScope } from "./store";
import { normalizeTheme, normalizeThemeSet } from "./theme-model";
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

export type ApplyThemeSet = (
  value: ThemeStorageValue | null | undefined,
  options?: {
    broadcast?: boolean;
    persist?: boolean;
    source?: ThemeSource;
    sun?: SunThemeStatus | null;
  },
) => void;

export type LoadTheme = (
  requestedScope?: ThemeConfigScope,
  options?: { background?: boolean },
) => Promise<void>;

/** The refs useDeviceTheme's callbacks read instead of state, so they stay stable. */
export type ThemeHookRefs = {
  activeVariantRef: MutableRefObject<ThemeVariant>;
  sunStatusRef: MutableRefObject<SunThemeStatus | null>;
  themeRef: MutableRefObject<DeviceTheme>;
  themeScopeRef: MutableRefObject<ThemeConfigScope>;
  themeSetRef: MutableRefObject<ReturnType<typeof normalizeThemeSet>>;
};

/**
 * useDeviceTheme's public setters, moved out as is. Every one funnels through
 * applyThemeSet (or loadTheme for a scope change) and reads current values
 * from the refs.
 */
export function useThemeSetters({
  activeVariantRef,
  applyThemeSet,
  loadTheme,
  setThemeReady,
  setThemeScopeState,
  sunStatusRef,
  themeRef,
  themeScopeRef,
  themeSetRef,
}: ThemeHookRefs & {
  applyThemeSet: ApplyThemeSet;
  loadTheme: LoadTheme;
  setThemeReady: Dispatch<SetStateAction<boolean>>;
  setThemeScopeState: Dispatch<SetStateAction<ThemeConfigScope>>;
}) {
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
    resetTheme,
    setTheme,
    setThemeColor,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
  };
}
