"use client";

// The device's reminder viewer, as the `nova-viewer` cookie the server reads
// (specs/private-reminders.md, section 2). A cookie because it rides on every
// fetch and EventSource with no call-site change. Written here whenever the
// device's home user changes; the head script (app/shell/viewer-cookie-script.ts)
// writes it once before anything else runs on a page load.

export const VIEWER_COOKIE_NAME = "nova-viewer";
const ONE_YEAR_SECONDS = 31_536_000;

/** `null` clears the cookie: no user chosen, which the server reads as household. */
export function setViewerCookie(value: string | null) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = value
      ? `${VIEWER_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`
      : `${VIEWER_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Cookies blocked: the server then reads household, which fails closed.
  }
}