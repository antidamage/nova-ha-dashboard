"use client";

const SELECTED_ZONE_STORAGE_KEY = "nova.dashboard.selectedZone.v1";

type FullscreenDocumentShim = Document & {
  fullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElementShim = HTMLElement & {
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function selectedZoneIdFromStorage() {
  if (typeof window === "undefined") {
    return "everything";
  }

  try {
    return window.sessionStorage.getItem(SELECTED_ZONE_STORAGE_KEY) ?? "everything";
  } catch {
    return "everything";
  }
}

export function writeSelectedZoneToStorage(zoneId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(SELECTED_ZONE_STORAGE_KEY, zoneId);
  } catch {
    // Browsers can deny storage in private or restricted contexts; selection can still live in React state.
  }
}

export function removeLegacySelectedZoneParam() {
  if (typeof window === "undefined") {
    return;
  }

  const current = new URL(window.location.href);
  if (!current.searchParams.has("zone")) {
    return;
  }

  current.searchParams.delete("zone");
  const nextSearch = current.searchParams.toString();
  const nextUrl = `${current.pathname}${nextSearch ? `?${nextSearch}` : ""}${current.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function isFullscreenActive() {
  const fullscreenDocument = document as FullscreenDocumentShim;
  return Boolean(
    fullscreenDocument.fullscreenElement
    ?? fullscreenDocument.webkitFullscreenElement
    ?? fullscreenDocument.mozFullScreenElement
    ?? fullscreenDocument.msFullscreenElement,
  );
}

export async function requestDashboardFullscreen() {
  if (isFullscreenActive()) {
    return;
  }

  const element = document.documentElement as FullscreenElementShim;
  const request =
    element.requestFullscreen
    ?? element.webkitRequestFullscreen
    ?? element.mozRequestFullScreen
    ?? element.msRequestFullscreen;

  if (!request) {
    return;
  }

  try {
    await request.call(element);
  } catch {
    // Browsers often require user activation for fullscreen. This preference is best-effort.
  }
}
