import { applyTouch, loadState, readTimings, saveState } from "../../../../../lib/kiosk-witness";
import { scheduleDigestFlush } from "../../../../../lib/control-attribution";
import { witnessKeyAccepted, witnessRejection } from "../../../../../lib/witness-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Someone is still at the panel" — no capture was taken.
 *
 * This is the cheap half of the optimisation. The first touch of a visit costs
 * a clip, an upload and a GPU inference; every touch within
 * `KIOSK_IDENTITY_TTL_SECONDS` costs this instead, which is one small POST.
 *
 * It exists as its own route rather than being inferred from control mutations
 * because the session clock has to track REAL activity: somebody tapping around
 * without changing anything is still present, and a session whose clock only
 * advanced on writes would close underneath them and split one visit into two.
 *
 * See `specs/kiosk-attribution.md`.
 */
export async function POST(request: Request) {
  if (!witnessKeyAccepted(request)) return witnessRejection();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "";
  if (!sessionId) {
    return Response.json({ ok: false, reason: "session_required" }, { status: 400 });
  }

  const state = await loadState();
  await saveState(
    applyTouch(
      state,
      { sessionId, at: typeof body.at === "string" ? body.at : undefined },
      Date.now(),
      readTimings(),
    ),
  );
  scheduleDigestFlush();

  return Response.json({ ok: true });
}
