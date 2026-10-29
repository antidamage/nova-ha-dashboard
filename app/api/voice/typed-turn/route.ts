import { NextResponse } from "next/server";
import { sendVoiceHostTypedTurn } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 2000;

// The whole turn runs before the voice host answers, spoken reply included, so
// this is sized like the text utterance relay rather than a status poll.
const TYPED_TURN_TIMEOUT_MS = 90_000;

/**
 * The live transcript's typed input. The voice host injects the text after STT
 * as the primary user; the transcript lines arrive over the usual SSE stream,
 * so the response here only reports whether the turn ran.
 */
export async function POST(request: Request) {
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Type something to send" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Messages must be ${MAX_TEXT_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }
  const result = await sendVoiceHostTypedTurn(text, TYPED_TURN_TIMEOUT_MS);
  if (!("payload" in result)) {
    return NextResponse.json(
      { error: `Voice server: ${result.error}` },
      { status: result.status && result.status >= 400 ? result.status : 502 },
    );
  }
  return NextResponse.json(result.payload, { headers: { "Cache-Control": "no-store" } });
}
