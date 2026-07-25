"use client";

const SELECTED_ZONE_STORAGE_KEY = "nova.dashboard.selectedZone.v1";

type FullscreenDocumentShim = Document & {
  fullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElementShim = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function selectedZoneIdFromStorage() {
  if (typeof window === "undefined") {
    return "everything";
  }

  try {
    // localStorage so the selection survives kiosk/browser restarts, not just
    // same-tab reloads; the sessionStorage read is a one-time migration from
    // the old slot.
    return (
      window.localStorage.getItem(SELECTED_ZONE_STORAGE_KEY)
      ?? window.sessionStorage.getItem(SELECTED_ZONE_STORAGE_KEY)
      ?? "everything"
    );
  } catch {
    return "everything";
  }
}

export function writeSelectedZoneToStorage(zoneId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SELECTED_ZONE_STORAGE_KEY, zoneId);
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

// A window the browser itself opened fullscreen (F11, or a kiosk launched with
// --start-fullscreen) has no fullscreenElement, yet the page already fills the
// screen. Treat that as satisfied: the Fullscreen API cannot be entered without
// a user gesture, so retrying against an already-fullscreen window only burns
// rejected promises until someone taps the screen.
function isWindowFullscreen() {
  try {
    if (window.matchMedia?.("(display-mode: fullscreen)").matches) {
      return true;
    }
  } catch {
    // matchMedia can be unavailable in restricted contexts.
  }

  const screenHeight = window.screen?.height ?? 0;
  const screenWidth = window.screen?.width ?? 0;
  if (screenHeight <= 0 || screenWidth <= 0) {
    return false;
  }

  const tolerance = 2;
  return Math.abs(window.innerHeight - screenHeight) <= tolerance
    && Math.abs(window.innerWidth - screenWidth) <= tolerance;
}

export function isDashboardFullscreen() {
  return isFullscreenActive() || isWindowFullscreen();
}

export async function requestDashboardFullscreen() {
  if (isDashboardFullscreen()) {
    return;
  }

  const element = document.documentElement as FullscreenElementShim;

  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen({ navigationUI: "hide" });
      return;
    }

    const request =
      element.webkitRequestFullscreen
      ?? element.mozRequestFullScreen
      ?? element.msRequestFullscreen;

    if (!request) {
      return;
    }

    await request.call(element);
  } catch {
    // Browsers often require user activation for fullscreen. This preference is best-effort.
  }
}
