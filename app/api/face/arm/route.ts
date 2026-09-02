import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Clears a lockout and re-arms face release.
 *
 * Reachable only through the authentik-gated `/api/face/*` matcher — password +
 * TOTP, **never a face**. The lockout exists precisely because faces are being
 * refused, so a face that could clear it would be a control that disables
 * itself under attack. `specs/face-auth.md` § The revocation-only asymmetry
 * makes this a rule rather than a preference: nothing may be added here, or in
 * the Discord veto, that arms face login from anything weaker than this path.
 */
export async function POST(request: Request) {
  // The authentik identity headers Caddy copied on are what make this route
  // password+TOTP rather than "anyone who can reach the dashboard". Dropping
  // them 403s the only sanctioned way to clear a lockout.
  return proxyFaceAuthJson("/arm", { method: "POST", headers: forwardedHeaders(request) });
}
