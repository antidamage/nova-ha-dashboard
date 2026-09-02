import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Issues the single-use replay nonce a clip is submitted with.
 *
 * Deliberately ungated in `ops/iridium/nova.Caddyfile` — this is on the login
 * path, and gating it would mean needing a session to get a session
 * (`specs/face-auth.md` § Route gating). What protects it instead is the
 * service's own network binding, the 20 s nonce TTL, the lockout counters, and
 * the key this proxy injects server-side.
 */
export async function POST(request: Request) {
  // Ungated, but network-bound: the service needs the real client address to
  // decide LAN/tailnet, and sees only loopback without the forwarded header.
  return proxyFaceAuthJson("/challenge", { method: "POST", headers: forwardedHeaders(request) });
}
