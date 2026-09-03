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

/** Prefix stripped by Caddy's `handle_path`, so authentik sees its own paths. */
export const AUTHENTIK_PREFIX = "/authentik";

export const FLOW_DEFAULT = "default-authentication-flow";
export const FLOW_PASSKEY = "passkey-login";
export const FLOW_FACE = "face-auth-webauthn";

export type FlowFieldError = { string?: string; code?: string };

export type DeviceChallenge = {
  device_class: string;
  device_uid: string;
  challenge: Record<string, unknown>;
  last_used?: string | null;
};

/**
 * One executor challenge. Deliberately loose: authentik adds fields between
 * versions, and a client that fails on an unrecognised key would break on
 * upgrade. The fields named here are the ones the surface actually reads.
 */
export type FlowChallenge = {
  component: string;
  flow_info?: { title?: string; cancel_url?: string; layout?: string };
  response_errors?: Record<string, FlowFieldError[]>;

  // ak-stage-identification
  user_fields?: string[];
  password_fields?: boolean;
  passwordless_url?: string | null;
  primary_action?: string;
  application_pre?: string;

  // ak-stage-authenticator-validate
  device_challenges?: DeviceChallenge[];
  pending_user?: string;

  // ak-stage-access-denied
  error_message?: string;

  // xak-flow-redirect
  to?: string;

  [key: string]: unknown;
};

/** authentik's terminal component: the flow is finished, go to `to`. */
export const FLOW_REDIRECT = "xak-flow-redirect";

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
 * Start (or restart) a flow and read its first challenge.
 *
 * `cache: "no-store"` matters: a cached challenge carries a stale WebAuthn
 * nonce, and the assertion built from it is refused with an error that looks
 * like a broken credential rather than a cache hit.
 */
export async function beginFlow(slug: string): Promise<FlowChallenge> {
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

/**
 * Answer the current challenge and read the next one.
 *
 * **A stage POST answers 302 back to the executor URL itself**, rather than
 * returning the next challenge inline — verified live against the running
 * instance. `redirect: "follow"` is therefore load-bearing: with `manual` the
 * body is empty and the next challenge never arrives.
 */
export async function submitFlow(
  slug: string,
  payload: Record<string, unknown>,
): Promise<FlowChallenge> {
  let response: Response;
  try {
    response = await fetch(flowUrl(slug), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new FlowTransportError("The sign-in service could not be reached.");
  }
  return readChallenge(response);
}

/** First error string authentik attached to a named field, if any. */
export function fieldError(challenge: FlowChallenge, field: string): string | null {
  const errors = challenge.response_errors?.[field];
  const first = Array.isArray(errors) ? errors[0] : undefined;
  return typeof first?.string === "string" && first.string ? first.string : null;
}

/**
 * The best single sentence to show for a challenge that came back with
 * problems. Field errors are rendered beside their fields; this is for the
 * non-field case and for stages with no fields at all.
 */
export function challengeError(challenge: FlowChallenge): string | null {
  if (typeof challenge.error_message === "string" && challenge.error_message) {
    return challenge.error_message;
  }
  const errors = challenge.response_errors;
  if (!errors) return null;
  // `non_field_errors` is DRF's own key; anything else is a field the surface
  // does not render, and showing it unlabelled beats showing nothing.
  for (const key of ["non_field_errors", ...Object.keys(errors)]) {
    const first = errors[key]?.[0];
    if (typeof first?.string === "string" && first.string) return first.string;
  }
  return null;
}

export function isTerminal(challenge: FlowChallenge): boolean {
  return challenge.component === FLOW_REDIRECT;
}

/* ------------------------------------------------------------------ *
 * base64url
 * ------------------------------------------------------------------ */

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  // Backed by an explicit ArrayBuffer rather than the inferred ArrayBufferLike:
  // `BufferSource` in the WebAuthn types excludes SharedArrayBuffer, so the
  // loose inference will not satisfy PublicKeyCredentialRequestOptions.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ------------------------------------------------------------------ *
 * WebAuthn
 * ------------------------------------------------------------------ */

/** The first `webauthn` device challenge on a validate stage, if there is one. */
export function webauthnChallenge(challenge: FlowChallenge): DeviceChallenge | null {
  return challenge.device_challenges?.find((entry) => entry.device_class === "webauthn") ?? null;
}

/** The raw base64url challenge string, which the face oracle signs verbatim. */
export function webauthnChallengeValue(device: DeviceChallenge): string | null {
  const value = device.challenge?.challenge;
  return typeof value === "string" && value ? value : null;
}

/**
 * Turn authentik's device challenge into the options `navigator.credentials.get`
 * wants. `allowCredentials` is normally empty here: the credentials are
 * discoverable and carry the identity, which is what lets the passkey replace
 * the username rather than confirm it.
 */
export function toCredentialRequestOptions(device: DeviceChallenge): PublicKeyCredentialRequestOptions {
  const raw = device.challenge ?? {};
  const allow = Array.isArray(raw.allowCredentials) ? raw.allowCredentials : [];
  return {
    challenge: base64UrlToBytes(String(raw.challenge ?? "")),
    rpId: typeof raw.rpId === "string" ? raw.rpId : undefined,
    timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
    userVerification: (raw.userVerification as UserVerificationRequirement | undefined) ?? undefined,
    allowCredentials: allow.map((entry: Record<string, unknown>) => ({
      type: "public-key" as const,
      id: base64UrlToBytes(String(entry.id ?? "")),
      transports: Array.isArray(entry.transports) ? (entry.transports as AuthenticatorTransport[]) : undefined,
    })),
  };
}

/**
 * The JSON shape authentik's `validate_challenge_webauthn` feeds to
 * py_webauthn's `parse_authentication_credential_json` — read from the running
 * container rather than guessed.
 */
export type AssertionPayload = {
  id: string;
  rawId: string;
  type: string;
  clientExtensionResults: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
};

/**
 * Serialise a browser assertion.
 *
 * Modern Chromium and Safari expose `toJSON()`, which produces exactly this
 * shape; the manual branch is for everything else. Both are kept because the
 * kiosk browser and Adeline's phone are not the same vintage.
 */
export function assertionToPayload(credential: PublicKeyCredential): AssertionPayload {
  const withToJson = credential as PublicKeyCredential & { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === "function") {
    // The DOM types describe toJSON() as the registration-or-authentication
    // union; on an assertion it is always the authentication shape.
    return withToJson.toJSON() as AssertionPayload;
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults() as Record<string, unknown>,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : null,
    },
  };
}

/**
 * The same shape, assembled from the face oracle's `/assert` reply.
 *
 * The oracle is a host authenticator, not a browser: it constructs
 * `clientDataJSON` itself with a pinned origin and hands back base64url
 * strings, so there is nothing to encode here — only to arrange.
 */
export function faceAssertionToPayload(assert: {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string | null;
}): AssertionPayload {
  return {
    id: assert.credentialId,
    rawId: assert.credentialId,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: assert.clientDataJSON,
      authenticatorData: assert.authenticatorData,
      signature: assert.signature,
      userHandle: assert.userHandle ?? null,
    },
  };
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
