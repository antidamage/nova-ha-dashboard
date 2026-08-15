import { NextResponse } from "next/server";
import {
  assignVoiceHostSpeakerTemplate,
  deleteVoiceHostSpeakerTemplate,
} from "../../../../../lib/voice-host-settings";

type Context = { params: Promise<{ templateId: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { templateId } = await context.params;
  const result = await deleteVoiceHostSpeakerTemplate(templateId);
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}

export async function PATCH(request: Request, context: Context) {
  const { templateId } = await context.params;
  const body = await request.json() as { personId?: unknown };
  if (typeof body.personId !== "string" || !body.personId) {
    return NextResponse.json({ error: "A person is required" }, { status: 422 });
  }
  const result = await assignVoiceHostSpeakerTemplate(templateId, body.personId);
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
