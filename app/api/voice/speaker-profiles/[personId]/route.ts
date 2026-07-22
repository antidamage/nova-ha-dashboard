import { NextResponse } from "next/server";
import {
  deleteIridiumSpeakerProfile,
  updateIridiumSpeakerProfile,
} from "../../../../../lib/iridium-voice-settings";

type Context = { params: Promise<{ personId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { personId } = await context.params;
  const body = await request.json() as {
    displayName?: unknown;
    pronouns?: unknown;
    speechPreferences?: unknown;
  };
  const update: Parameters<typeof updateIridiumSpeakerProfile>[1] = {};
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
  if (body.speechPreferences !== undefined) {
    if (!body.speechPreferences || typeof body.speechPreferences !== "object") {
      return NextResponse.json({ error: "Speech preferences must be an object" }, { status: 422 });
    }
    update.speechPreferences = body.speechPreferences as NonNullable<
      Parameters<typeof updateIridiumSpeakerProfile>[1]["speechPreferences"]
    >;
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
