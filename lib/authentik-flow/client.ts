/**
 * A minimal client for authentik's flow executor.
 *
 * Drives the same JSON API authentik's own web UI uses, so the Nova login
 * surface can render the sign-in itself rather than sending people to a page
 * that cannot offer face login. `specs/login-surface.md` owns the design; this
 * file owns the wire format.
 *
 * Everything here talks to `/authentik/*` on the dashboard's OWN origin, which
 * Caddy proxies to authentik with the `Host` header pinned. That is not a
 * convenience:
 *
 *   - authentik sends no CORS headers, so a cross-origin fetch to `:9443` is
 *     blocked outright; and
 *   - authentik derives the WebAuthn RP ID and expected origin from the request
 *     Host (`stages/authenticator_webauthn/utils.py`), so a flow served on
 *     `:9443` rejects an assertion produced by a page on `:443`.
 *
 * No secrets live here. These flows hand challenges to anonymous callers by
 * design — that is what a login endpoint does.
 */

import { AUTHENTIK_PREFIX, FLOW_REDIRECT } from "./constants";
import { CSRF_HEADER, csrfToken } from "./csrf";
import type { FlowChallenge } from "./types";

export function flowUrl(slug: string): string {
  return `${AUTHENTIK_PREFIX}/api/v3/flows/executor/${encodeURIComponent(slug)}/?query=`;
}

async function readChallenge(response: Response): Promise<FlowChallenge> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    // A redirect or an HTML page here is not a broken service: it is this
    // origin having no sign-in on it. `/authentik/*` is proxied on the tailnet
    // vhost only, so a LAN address falls through to Next.js and answers 308.
    // Saying "not responding" sent somebody hunting a fault that did not exist.
    if (response.redirected || response.status === 404 || (response.status >= 300 && response.status < 400)) {
      throw new FlowTransportError("There is no sign-in on this address. Use the HTTPS address.");
    }
    // A 500 with a session present is very likely the CSRF check: authentik
    // answers PermissionDenied that way rather than 403. Say something the
    // reader can act on instead of "not responding".
    if (response.status === 500 && csrfToken() === null) {
      throw new FlowTransportError(
        "Sign-in could not be verified. Sign in on the authentik page once, then try again.",
      );
    }
    throw new FlowTransportError(
      response.ok
        ? "The sign-in service returned something unreadable."
        : "The sign-in service is not responding.",
    );
  }
  return body as FlowChallenge;
}

/** Network or shape failure — distinct from a challenge that says "wrong password". */
export class FlowTransportError extends Error {}

/**
 * Read the flow's current challenge.
 *
 * `cache: "no-store"` matters: a cached challenge carries a stale WebAuthn
 * nonce, and the assertion built from it is refused with an error that looks
 * like a broken credential rather than a cache hit.
 */
async function readFlow(slug: string): Promise<FlowChallenge> {
  let response: Response;
  try {
    response = await fetch(flowUrl(slug), {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new FlowTransportError("The sign-in service could not be reached.");
  }
  return readChallenge(response);
}

/** Start (or restart) a flow and read its first challenge. */
export async function beginFlow(slug: string): Promise<FlowChallenge> {
  return readFlow(slug);
}

/**
 * True when a response is the executor's "go and re-read me" redirect.
 *
 * With `redirect: "manual"` a same-origin 3xx arrives as an opaque redirect:
 * `type === "opaqueredirect"`, status 0, no readable headers. Node's fetch and
 * jsdom expose the real 3xx status instead, so both shapes are recognised.
 */
function isExecutorRedirect(response: Response): boolean {
  if (response.type === "opaqueredirect") return true;
  return response.status === 0 || (response.status >= 300 && response.status < 400);
}

/**
 * Answer the current challenge and read the next one.
 *
 * **A stage POST answers 302 back to the executor URL itself**, rather than
 * returning the next challenge inline — verified live against the running
 * instance.
 *
 * **That redirect must NOT be followed, and this is the whole reason sign-in
 * was broken.** Caddy proxies `/authentik/*` with `handle_path`, which STRIPS
 * the prefix before authentik sees the request, so authentik builds its
 * `Location` from the stripped path:
 *
 *     Location: /api/v3/flows/executor/default-authentication-flow/?query=
 *
 * That path is not proxied. On the dashboard origin it is Next.js, which
 * answers 308 (trailing slash) and then 404 with an HTML body. So every stage
 * POST that the server ACCEPTED — password, TOTP, passkey, face alike — ended
 * at a 404 the client reported as a transport failure, moments after authentik
 * had logged "Successful authentication". Measured on 2026-09-04 against the
 * live instance; the server-side flow was never at fault.
 *
 * The Location carries no information anyway: it is always the executor URL
 * this client already knows. So the redirect is taken manually and the next
 * challenge is re-read from the PREFIXED url, which stays inside the proxy.
 */
export async function submitFlow(
  slug: string,
  payload: Record<string, unknown>,
): Promise<FlowChallenge> {
  const token = csrfToken();
  let response: Response;
  try {
    response = await fetch(flowUrl(slug), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      // See the note above: following this lands on Next.js, not authentik.
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Absent when nobody is signed in yet, which is also when authentik
        // does not ask for it.
        ...(token ? { [CSRF_HEADER]: token } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new FlowTransportError("The sign-in service could not be reached.");
  }
  // A stage that ACCEPTED the answer redirects; one that refused it answers
  // 200 with the same challenge and `response_errors` filled in.
  if (isExecutorRedirect(response)) return readFlow(slug);
  return readChallenge(response);
}

/**
 * Abandon a part-finished flow and start it again.
 *
 * authentik keeps the flow plan in the session, so re-opening the sign-in
 * resumes wherever it got to. That is correct, and it is also how somebody
 * ends up staring at "Authentication code" with no idea where the username
 * field went, or stuck on a stage they cannot complete. Cancelling clears the
 * plan; the caller then begins the flow afresh.
 *
 * Failure is not worth surfacing: the worst case is the flow resumes where it
 * was, which is where it already is.
 */
export async function cancelFlow(): Promise<void> {
  try {
    await fetch(`${AUTHENTIK_PREFIX}/flows/-/cancel/`, {
      credentials: "same-origin",
      cache: "no-store",
      // The cancel happens before the redirect is written, and that redirect
      // is unprefixed like every other one authentik emits behind
      // `handle_path` — following it would only fetch a Next.js 404.
      redirect: "manual",
    });
  } catch {
    // Nothing to do; the caller restarts regardless.
  }
}

export function isTerminal(challenge: FlowChallenge): boolean {
  return challenge.component === FLOW_REDIRECT;
}

/**
 * Where to go once a flow reaches `xak-flow-redirect`.
 *
 * Same-origin paths only. An open redirect on a login page is the standard way
 * to turn a themed sign-in into a phishing primitive, and authentik's `to` is
 * usually `/` but is not something this surface should trust blindly.
 */
export function safeNext(candidate: string | null | undefined, fallback = "/"): string {
  if (typeof candidate !== "string" || !candidate) return fallback;
  // Reject anything that could leave the origin: absolute URLs, protocol-
  // relative `//host`, and backslash variants browsers normalise to slashes.
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  return candidate;
}
