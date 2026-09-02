import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Disables face release until someone re-arms it from `/api/face/arm`.
 *
 * The counterpart to `arm/route.ts`, and deliberately NOT gated the same way.
 * `/arm` sits behind authentik forward-auth because arming *grants* the ability
 * to open a session; disarming only takes it away, and the whole point of the
 * veto channel is that it works in the seconds after a DM lands on a phone,
 * from whatever device is to hand, without a password + TOTP round trip.
 *
 * This is the revocation-only asymmetry from `specs/face-auth.md` expressed as
 * two routes: every path that reduces access is cheap to reach, every path that
 * increases it is expensive. The worst an attacker gains by reaching this route
 * is that face login stops working — a denial of service against a convenience,
 * recoverable by the owner from the gated `/arm`. That is a trade worth making.
 *
 * Called by the Discord veto's `Disarm face login` button and its signed
 * fallback link (`nova-module-discord/src/face-veto.ts`).
 */
export async function POST(request: Request) {
  return proxyFaceAuthJson("/disarm", { method: "POST", headers: forwardedHeaders(request) });
}
