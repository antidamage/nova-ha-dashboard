export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Who is signed in, according to authentik.
 *
 * The dashboard has no session of its own — authentication is enforced by Caddy
 * in front of Next.js, which copies `X-authentik-username`, `-groups` and
 * `-email` onto requests that passed the forward-auth gate. This route exists so
 * the UI can *ask* rather than guess, and it reads exactly those headers.
 *
 * **It answers 401, never a 302.** The Caddy block for this path wraps
 * `forward_auth` with a `handle_response` that turns the outpost's 302 into a
 * bare 401. That is the whole reason the route exists as its own matcher rather
 * than joining `@admin_any`: on 2026-09-03 live face enrolment failed because a
 * gated XHR received a cross-origin redirect, which a browser reports as an
 * opaque CORS error. "Opaque CORS error" is not something a UI can render as
 * "sign in", and a probe whose entire job is reporting auth state must answer
 * with a status the client can read.
 *
 * So reaching this handler at all means the gate passed. An unauthenticated
 * caller is answered by Caddy and never arrives here. The `null` branch below is
 * for the case where the gate is misconfigured or absent — a LAN vhost, a local
 * dev run — and it reports honestly rather than inventing a user.
 *
 * See `specs/login-surface.md` § Knowing whether anyone is signed in.
 */
export async function GET(request: Request) {
  const username = request.headers.get("x-authentik-username");
  const email = request.headers.get("x-authentik-email");
  const groups = request.headers.get("x-authentik-groups");

  if (!username) {
    // Reached the app without identity headers: the gate did not run. Say so
    // rather than reporting a session that does not exist.
    return Response.json({ authenticated: false, username: null }, { status: 200 });
  }

  return Response.json({
    authenticated: true,
    username,
    email: email || null,
    // authentik sends a `|`-separated list; an absent header is no groups, not
    // an error.
    groups: groups ? groups.split("|").filter(Boolean) : [],
  });
}
