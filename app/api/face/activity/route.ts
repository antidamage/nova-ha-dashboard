import { forwardedHeaders, proxyFaceAuthJson } from "../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Heartbeat for a quick-profile session.
 *
 * A `quick` or `image` sign-in traded the photo defences away for speed, and
 * what it got in return is a session that ends after 15 minutes of inactivity.
 * The service cannot see activity on its own — nothing about browsing the
 * dashboard reaches it — so the client says so, and this is the route that
 * carries it.
 *
 * Identity-bearing, so it forwards the authentik headers for the same reason
 * `/arm` does: the shared API key is held by every satellite and every script,
 * and without the proxy secret a key holder could assert any username. Here
 * that would mean holding somebody else's session open indefinitely.
 *
 * It can only extend, never grant. A caller with no open quick session is
 * answered `{touched: 0}`, which is not an error — a password or `standard`
 * face session has nothing to heartbeat and is expected to get exactly that.
 *
 * See `specs/login-surface.md` § What bounds it instead.
 */
export async function POST(request: Request) {
  return proxyFaceAuthJson("/activity", { method: "POST", headers: forwardedHeaders(request) });
}
