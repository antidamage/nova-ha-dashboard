"use client";

// document.cookie reads and writes for the theme and its scope.
import { THEME_COOKIE_NAME, THEME_SCOPE_COOKIE_NAME } from "./constants";
import { normalizeThemeSet } from "./theme-model";
import type { DeviceThemeSet, ThemeConfigScope } from "./types";

export function cookieValue(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

export function writeThemeScopeCookie(scope: ThemeConfigScope) {
  window.document.cookie = `${THEME_SCOPE_COOKIE_NAME}=${scope}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function writeThemeCookie(themeSet: DeviceThemeSet) {
  window.document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(normalizeThemeSet(themeSet)))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function removeThemeCookie() {
  window.document.cookie = `${THEME_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
