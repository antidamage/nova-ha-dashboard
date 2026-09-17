// authentik flow executor client — facade. The body lives in
// lib/authentik-flow/; this file keeps the import path stable for its callers
// (specs/agent-token-footprint.md §3.3).
//
// Drives the same JSON API authentik's own web UI uses, so the Nova login
// surface can render the sign-in itself rather than sending people to a page
// that cannot offer face login. `specs/login-surface.md` owns the design.
//
// Where things are:
//
//   authentik-flow/types.ts      FlowChallenge, DeviceChallenge, AssertionPayload
//   authentik-flow/constants.ts  AUTHENTIK_PREFIX, flow slugs, FLOW_REDIRECT
//   authentik-flow/csrf.ts       the CSRF cookie/header and its reader
//   authentik-flow/errors.ts     field/challenge error readers
//   authentik-flow/client.ts     the executor wire format: begin/submit/cancel
//   authentik-flow/webauthn.ts   base64url, and turning a device challenge into
//                                credential request options / assertion payloads

export type { FlowFieldError, DeviceChallenge, FlowChallenge, AssertionPayload } from "./authentik-flow/types";

export { AUTHENTIK_PREFIX, FLOW_DEFAULT, FLOW_PASSKEY, FLOW_FACE, FLOW_REDIRECT } from "./authentik-flow/constants";

export { csrfToken } from "./authentik-flow/csrf";
export { fieldError, challengeError } from "./authentik-flow/errors";

export {
  flowUrl,
  FlowTransportError,
  beginFlow,
  submitFlow,
  cancelFlow,
  isTerminal,
  safeNext,
} from "./authentik-flow/client";

export {
  base64UrlToBytes,
  bytesToBase64Url,
  webauthnChallenge,
  webauthnChallengeValue,
  toCredentialRequestOptions,
  assertionToPayload,
  faceAssertionToPayload,
} from "./authentik-flow/webauthn";
