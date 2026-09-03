import { timingSafeEqual } from "crypto";

/**
 * The shared key the Nocturnium witness daemon presents.
 *
 * Its OWN key, deliberately not the face service's. `lib/face-auth-client.ts`
 * already makes this argument for `X-Nova-Face-Proxy`: one credential may not
 * vouch for two different things. `NOVA_FACE_KEY` is held by every LAN service
 * that talks to the oracle, so reusing it here would let any of them post
 * observations claiming somebody was at the panel.
 *
 * Absent from the environment, every witness route rejects. That degrades to
 * today's behaviour — address-only attribution — rather than to an open
 * endpoint that anyone on the LAN can write identity claims into.
 */
export const WITNESS_HEADER = "x-nova-witness-key";

export function witnessKeyAccepted(request: Request): boolean {
  const expected = process.env.NOVA_WITNESS_KEY;
  if (!expected) return false;
  const supplied = request.headers.get(WITNESS_HEADER);
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a leak of
  // length; compare lengths first and always run the constant-time compare.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function witnessRejection(): Response {
  return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
}
