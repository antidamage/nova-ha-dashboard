import { NextResponse } from "next/server";
import { deleteAllVoiceHostSpeakerTemplates } from "../../../../lib/voice-host-settings";

export async function DELETE() {
  const result = await deleteAllVoiceHostSpeakerTemplates();
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
