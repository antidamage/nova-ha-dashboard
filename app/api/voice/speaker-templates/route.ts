import { NextResponse } from "next/server";
import { deleteAllIridiumSpeakerTemplates } from "../../../../lib/iridium-voice-settings";

export async function DELETE() {
  const result = await deleteAllIridiumSpeakerTemplates();
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
