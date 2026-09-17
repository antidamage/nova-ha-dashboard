/**
 * authentik's CSRF token, from the cookie its own web client reads.
 *
 * **CSRF is enforced, and only once a session exists.** This was recorded the
 * other way round after a probe that POSTed as an ANONYMOUS caller: DRF's
 * `SessionAuthentication.enforce_csrf` only runs when session authentication
 * resolves a user, so an anonymous POST sails through and an authenticated one
 * is refused. The moment somebody had signed in, every stage POST — password,
 * passkey and face alike — failed with
 * `CSRF Failed: CSRF token missing` and an HTTP 500.
 *
 * `CSRF_COOKIE_HTTPONLY` is false on this instance, so the cookie is readable
 * here by design. `CSRF_COOKIE_DOMAIN` is None, making it host-only — which
 * still covers both ports, since cookies ignore them.
 */
export const CSRF_COOKIE = "authentik_csrf";
export const CSRF_HEADER = "X-authentik-CSRF";

export function csrfToken(cookie?: string): string | null {
  const source = cookie ?? (typeof document === "undefined" ? "" : document.cookie);
  // Split rather than match. A template-literal regex swallowed the `\s`
  // escape and silently matched nothing, which is exactly the sort of failure
  // this whole area has already produced too much of.
  for (const part of source.split(";")) {
    const entry = part.trim();
    const eq = entry.indexOf("=");
    if (eq > 0 && entry.slice(0, eq) === CSRF_COOKIE) {
      return decodeURIComponent(entry.slice(eq + 1));
    }
  }
  return null;
}
