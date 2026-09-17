import type { AssertionPayload, DeviceChallenge, FlowChallenge } from "./types";

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
