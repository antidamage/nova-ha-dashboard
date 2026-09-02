import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `{ ok, provider, models, subjects, version }` from the service's `/healthz`.
 *
 * **Gated**, via `/api/face/health` in the `@admin_any` matcher in
 * `ops/iridium/nova.Caddyfile`. The service requires the shared key on
 * `/healthz`, but this proxy supplies that key for whoever calls it, so without
 * the Caddy gate the route would hand the enrolled headcount and the live ONNX
 * provider to anyone who could load the dashboard — re-creating at the proxy
 * exactly the disclosure the key exists to prevent. An earlier version of this
 * file was ungated and claimed in its own docblock to be safe; it was not.
 *
 * It matters more once `armed` is reported here: an ungated health route would
 * give an attacker a live oracle for their own lockout campaign — "have my
 * spoof attempts tripped the counter yet, and has it reset?" — which turns the
 * most important control from blind into instrumented.
 *
 * Not currently read by the enrolment UI. Left in place because the disarmed
 * case genuinely should be surfaced before someone records five clips into a
 * refusal, but that wiring does not exist yet and this comment will not claim
 * it does.
 */
export async function GET(request: Request) {
  return proxyFaceAuthJson("/healthz", { headers: forwardedHeaders(request) });
}
