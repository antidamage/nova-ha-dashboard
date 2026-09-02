import { forwardedHeaders, proxyFaceAuthJson } from "../../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Terminates one authentik session that a face opened, leaving face login armed.
 *
 * Ungated for the same reason as `disarm/route.ts`: it can only take access
 * away. The session id it revokes is carried in the body and was minted by
 * nova-face-auth itself, so a caller who guesses one achieves nothing an
 * attacker wants — the effect is to log somebody out.
 *
 * The narrower of the two veto actions. `Revoke this session` kills the session
 * that was just opened and leaves face login usable; `Disarm face login` is the
 * bigger hammer for "that was not me at all". Both are offered on every notice
 * because the right one depends on whether the owner recognises the login.
 */
export async function POST(request: Request) {
  const body = await request.text();
  return proxyFaceAuthJson("/sessions/revoke", {
    method: "POST",
    headers: (() => {
      const h = forwardedHeaders(request);
      h.set("Content-Type", "application/json");
      return h;
    })(),
    body,
  });
}
