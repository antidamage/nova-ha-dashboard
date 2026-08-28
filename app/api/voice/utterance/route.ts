import { NextResponse } from "next/server";
import { sendVoiceHostUtterance } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TRANSCRIPT_LENGTH = 2000;

/**
 * A full agent turn — inference, tool calls, the verification loop — takes far
 * longer than the 5s default, which is sized for status polls. A cold first turn
 * after the voice service restarts is longer still, because the models load on
 * it. Text has no real-time constraint the way speech does, so it can wait.
 */
const UTTERANCE_TIMEOUT_MS = 90_000;

/**
 * Put a text utterance through the voice agent.
 *
 * The relay lives here rather than in whatever is calling it so the voice-host
 * URL and mTLS identity stay in the dashboard, where they already are. Text
 * channels (the Discord module today) get the same LLM, the same MCP tool
 * surface, and the same verification loop as speech.
 *
 * `dryRun` defaults to TRUE. A caller that wants the house changed has to say
 * so — see `specs/discord-bot-module.md` for why that default matters.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      transcript?: unknown;
      satelliteId?: unknown;
      roomId?: unknown;
      dryRun?: unknown;
    };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) {
      return NextResponse.json({ error: "A transcript is required" }, { status: 400 });
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return NextResponse.json(
        { error: `Transcript must be ${MAX_TRANSCRIPT_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const outcome = await sendVoiceHostUtterance({
      transcript,
      satelliteId: typeof body.satelliteId === "string" && body.satelliteId ? body.satelliteId : "dashboard-text",
      roomId: typeof body.roomId === "string" && body.roomId ? body.roomId : "dashboard",
      dryRun: body.dryRun !== false,
      timeoutMs: UTTERANCE_TIMEOUT_MS,
    });

    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status ?? 502 });
    }
    return NextResponse.json(outcome.result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Utterance failed" },
      { status: 400 },
    );
  }
}
