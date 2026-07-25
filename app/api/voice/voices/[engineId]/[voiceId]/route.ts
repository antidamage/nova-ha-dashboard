import { NextResponse } from "next/server";
import { deleteIridiumEngineVoice } from "../../../../../../lib/iridium-voice-settings";

type Context = { params: Promise<{ engineId: string; voiceId: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { engineId, voiceId } = await context.params;
  const result = await deleteIridiumEngineVoice(engineId, voiceId);
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
