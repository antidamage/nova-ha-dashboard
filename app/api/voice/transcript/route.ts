import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  clearVoiceTranscripts,
  getVoiceTranscripts,
  publishVoiceTranscript,
  replaceVoiceTranscript,
} from "../../../../lib/dashboard-events";
import { endIridiumConversations } from "../../../../lib/voice-host-settings";
import {
  parseVoiceTranscriptInput,
  parseVoiceTranscriptReplaceInput,
} from "../../../../lib/voice-transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ transcripts: getVoiceTranscripts() });
}

// Clearing the log is a "forget this conversation" gesture, not just a screen
// wipe: the open conversation windows and the frozen context they carry are
// ended on the voice server too, so the next utterance needs the wake word
// again and starts from a fresh household snapshot. The voice server being
// unreachable must never leave the panel uncleared, so that half is best
// effort and its outcome is reported rather than thrown.
export async function DELETE() {
  const cleared = clearVoiceTranscripts();
  const ended = await endIridiumConversations();
  return NextResponse.json({
    ok: true,
    ...cleared,
    conversationsCleared: !("error" in ended),
  });
}

// Iridium posts each accepted user transcript and each spoken response here.
// The dashboard keeps only a bounded process-local snapshot and publishes the
// new line to every connected client over the existing shared SSE stream.
// A body carrying replacesId upgrades an already-displayed line in place (a
// longer rendering of the same utterance) instead of appending a duplicate.
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "replacesId" in body) {
      const replace = parseVoiceTranscriptReplaceInput(body);
      const replaced = replaceVoiceTranscript(
        replace.replacesId,
        replace.text,
        replace.at,
        replace.kind,
        replace.speakerName,
        replace.outcome,
        replace.decision,
      );
      if (replaced) {
        return NextResponse.json({ ok: true, transcript: replaced });
      }
      // The line to upgrade has already aged out; record the text normally so
      // the utterance is not lost from the panel.
    }
    const parsed = parseVoiceTranscriptInput(body);
    const transcript = { ...parsed, id: parsed.id ?? randomUUID() };
    publishVoiceTranscript(transcript);
    return NextResponse.json({ ok: true, transcript });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid transcript" },
      { status: 400 },
    );
  }
}
