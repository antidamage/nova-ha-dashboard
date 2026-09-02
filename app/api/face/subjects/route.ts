import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The enrolled household gallery: `[{ id, name, clips, ready, createdAt }]` — no image, by design.
 *
 * Gated behind authentik forward-auth at the Caddy layer, tailnet origin only —
 * listing subjects enumerates the household. This route does not re-check that;
 * Caddy is the gate and `ops/iridium/nova.Caddyfile` is its authority.
 */
export async function GET(request: Request) {
  return proxyFaceAuthJson("/subjects", { headers: forwardedHeaders(request) });
}
