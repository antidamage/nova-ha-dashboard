import { NextResponse } from "next/server";
import {
  buildIridiumEngineVoice,
  fetchIridiumEngineVoices,
} from "../../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ engineId: string }> };

// An engine's voice catalogue (Voice Infrastructure -> Custom/Trained voices).
// Engines with no catalogue (Classic) get an empty list rather than an error --
// the panel simply has nothing to render.
export async function GET(_request: Request, context: Context) {
  const { engineId } = await context.params;
  const voices = await fetchIridiumEngineVoices(engineId);
  return NextResponse.json({ voices: voices ?? [] });
}

// Build/replace a voice in this engine's catalogue from an uploaded multipart
// form. The browser sends the same shape a user would drive by hand -- for
// Custom that's id/name/language/speaker_scale/files[] (sample clips the
// server builds into a reference.wav); for Trained it's the checkpoint bundle
// produced by the voice-training scripts. This route forwards the raw body
// and content-type unchanged rather than re-parsing the multipart data,
// matching the orchestrator's own relay pattern.
export async function POST(request: Request, context: Context) {
  const { engineId } = await context.params;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0) {
    return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
  }
  const result = await buildIridiumEngineVoice(engineId, body, contentType);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  }
  return NextResponse.json({ ok: true, voice: result.voice });
}
