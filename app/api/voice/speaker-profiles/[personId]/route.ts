import { NextResponse } from "next/server";
import {
  deleteIridiumSpeakerProfile,
  updateIridiumSpeakerProfile,
} from "../../../../../lib/iridium-voice-settings";

type Context = { params: Promise<{ personId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { personId } = await context.params;
  const body = await request.json() as { displayName?: unknown; pronouns?: unknown };
  const update: { displayName?: string; pronouns?: string | null } = {};
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== "string" || !body.displayName.trim()) {
      return NextResponse.json({ error: "Display name cannot be empty" }, { status: 422 });
    }
    update.displayName = body.displayName.trim();
  }
  if (body.pronouns !== undefined) {
    if (body.pronouns !== null && typeof body.pronouns !== "string") {
      return NextResponse.json({ error: "Pronouns must be text" }, { status: 422 });
    }
    update.pronouns = typeof body.pronouns === "string" ? body.pronouns.trim() : null;
  }
  const result = await updateIridiumSpeakerProfile(personId, update);
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}

export async function DELETE(_request: Request, context: Context) {
  const { personId } = await context.params;
  const result = await deleteIridiumSpeakerProfile(personId);
  return "payload" in result
    ? NextResponse.json(result.payload)
    : NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
}
