import { applyObservation, loadState, readTimings, saveState } from "../../../../lib/kiosk-witness";
import { scheduleDigestFlush } from "../../../../lib/control-attribution";
import { witnessKeyAccepted, witnessRejection } from "../../../../lib/witness-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Nocturnium witness daemon reporting who it saw at the panel.
 *
 * Body: `{ sessionId, subject, score, runnerUp, at }`, with `subject: null`
 * when the face is not enrolled. **Never an image** — the daemon posts an
 * identifier and a score, and the clip it captured is deleted before this
 * request is made.
 *
 * Ungated in Caddy (it is under the never-gated `/api/kiosk/**`) and protected
 * instead by `X-Nova-Witness-Key`, which the daemon holds and browsers do not.
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
  const next = applyObservation(
    state,
    {
      sessionId,
      // An empty string is not a person. Only a non-empty subject counts as an
      // identification; anything else is "nobody recognised", never a guess.
      subject: typeof body.subject === "string" && body.subject ? body.subject.slice(0, 128) : null,
      score: typeof body.score === "number" ? body.score : null,
      at: typeof body.at === "string" ? body.at : undefined,
    },
    Date.now(),
    readTimings(),
  );
  await saveState(next);
  scheduleDigestFlush();

  return Response.json({ ok: true, sessionId });
}
