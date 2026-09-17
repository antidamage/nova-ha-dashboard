/**
 * The checks that need no session: executor, stages, LAN origin.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { EXECUTOR, RP_ID, TAILNET } from "./config.mjs";
import { isRedirect, request } from "./http.mjs";
import { lanProbe } from "./remote.mjs";

export async function checkExecutorReachable() {
  const res = await request(EXECUTOR(TAILNET, "default-authentication-flow"));
  const isJson = res.contentType.includes("application/json") && res.json !== null;
  return {
    pass: res.status === 200 && isJson,
    evidence: `${res.status} ${res.contentType.split(";")[0]} component=${res.json?.component ?? "-"}`,
  };
}

export async function checkPasswordOnOneScreen() {
  const res = await request(EXECUTOR(TAILNET, "default-authentication-flow"));
  const c = res.json || {};
  const ok =
    res.status === 200 &&
    c.component === "ak-stage-identification" &&
    c.password_fields === true &&
    typeof c.passwordless_url === "string" &&
    c.passwordless_url.length > 0;
  return {
    pass: ok,
    evidence: `${res.status} component=${c.component} password_fields=${c.password_fields} passwordless_url=${c.passwordless_url ?? "MISSING"}`,
  };
}

export async function checkWebauthnChallenge(slug) {
  const res = await request(EXECUTOR(TAILNET, slug));
  const dc = res.json?.device_challenges?.find((d) => d.device_class === "webauthn");
  const rpId = dc?.challenge?.rpId;
  return {
    pass:
      res.status === 200 &&
      !!dc &&
      rpId === RP_ID &&
      typeof dc.challenge?.challenge === "string",
    evidence: `${res.status} device_class=${dc?.device_class ?? "NONE"} rpId=${rpId ?? "MISSING"} userVerification=${dc?.challenge?.userVerification ?? "-"}`,
  };
}

export async function checkWhoamiUnauthenticated() {
  const res = await request(`${TAILNET}/api/auth/whoami`);
  return {
    pass: res.status === 401 && !isRedirect(res.status),
    evidence: `${res.status}${res.location ? ` -> ${res.location}` : ""} (401 required; a redirect reaches an XHR as an opaque CORS error)`,
  };
}

export async function checkLanOffersNoSignIn() {
  const whoami = await lanProbe("/api/auth/whoami");
  const flow = await lanProbe(
    "/authentik/api/v3/flows/executor/default-authentication-flow/?query=",
  );

  // The UI must be able to READ the answer: a status it can branch on, never a
  // redirect, and never an authenticated identity.
  const whoamiReadable =
    whoami.status === 403 ||
    (whoami.status === 200 && !!whoami.json && whoami.json.authenticated === false);
  // `ak_flow_routes` is not imported on the LAN vhosts, so /authentik/* must
  // fall through to Next.js. Anything answering a flow challenge here is a
  // misconfiguration that hands the LAN a login path it can never satisfy.
  const flowNotProxied = !(flow.json && typeof flow.json.component === "string");

  return {
    pass: whoamiReadable && flowNotProxied,
    evidence: `via ${whoami.via} | whoami=${whoami.status}${whoami.json ? ` authenticated=${whoami.json.authenticated}` : ""} | /authentik/*=${flow.status} ${flow.contentType.split(";")[0]}${flowNotProxied ? " (not proxied)" : " (PROXIED, leak)"}`,
  };
}
