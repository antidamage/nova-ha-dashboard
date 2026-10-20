"use client";

import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { readSunStatus } from "./client";
import {
  HOUSE_PARTY_THEME_OVERRIDE_EVENT,
  NOVA_THEME_SET_CHANGE_EVENT,
  SHARED_THEME_POLL_MS,
  SHARED_THEME_STORAGE_KEY,
  SUN_CHANGE_EVENT,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_STORAGE_KEY,
  THEME_SCOPE_CHANGE_EVENT,
  THEME_SCOPE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
import { normalizeThemeScope, recordValue } from "./normalize-model";
import { isThemePollingPaused, readThemeOverride } from "./store";
import { normalizeTheme } from "./theme-model";
import { effectiveThemeSelection } from "./variant-model";
import type { ApplyThemeSet, LoadTheme, ThemeHookRefs } from "./useThemeSetters";
import type { DeviceTheme, SunThemeStatus, ThemeConfigScope, ThemeStorageValue } from "./types";

/**
 * useDeviceTheme's two subscriptions, moved out as is: the window events that
 * re-read or re-resolve the theme (storage, scope, override, other instances,
 * sun, house party), and the shared-scope poll.
 */
export function useThemeSync({
  applyThemeSet,
  instanceIdRef,
  loadTheme,
  setRuntimeThemeOverride,
  setThemeReady,
  sunStatusRef,
  themeScope,
  themeScopeRef,
  themeSetRef,
}: Pick<ThemeHookRefs, "sunStatusRef" | "themeScopeRef" | "themeSetRef"> & {
  applyThemeSet: ApplyThemeSet;
  instanceIdRef: MutableRefObject<number>;
  loadTheme: LoadTheme;
  setRuntimeThemeOverride: Dispatch<SetStateAction<DeviceTheme | null>>;
  setThemeReady: Dispatch<SetStateAction<boolean>>;
  themeScope: ThemeConfigScope;
}) {
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

}
