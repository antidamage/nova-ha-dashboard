import { activityView, loadState, readTimings } from "../../../../../lib/kiosk-witness";
import { flushDigest } from "../../../../../lib/control-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Recent kiosk sessions, for the config panel.
 *
 * **Gated**, via `/api/kiosk/witness/activity` in the `@admin_any` matcher in
 * `ops/iridium/nova.Caddyfile`, matched by PATH and never by method. A list of
 * who was in the room, and when, is the same class of thing as the enrolled
 * headcount that `/api/face/health` is gated for. `@admin_writes` would not do:
 * it filters on PUT/POST/PATCH/DELETE, so a GET would match neither matcher and
 * fall through completely ungated — the exact mistake that briefly exposed the
 * face subject thumbnail on the LAN.
 *
 * Reading also flushes an overdue digest. That is the restart safety net: the
 * quiet timer dies with the process, but `lastTouchAt` survives, so a session
 * that went quiet while nobody was watching still reports rather than being
 * silently dropped.
 */
export async function GET() {
  await flushDigest();
  const state = await loadState();
  return Response.json({
    sessions: activityView(state, Date.now(), readTimings()),
  });
}
