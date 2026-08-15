import { NextResponse } from "next/server";
import {
  fetchVoiceHostEngineStatus,
  requestVoiceHostEngineSwitch,
} from "../../../../lib/voice-host-settings";
import { VOICE_ENGINES } from "../../../../lib/voice-settings";

export const dynamic = "force-dynamic";

// A shape-level guard against the known engine ids, so an obviously malformed
// request gets a friendly 400 without a round trip. The voice server's own
// EngineSwitchRequest validator (checked against its live engine registry) is
// the actual source of truth -- this list just needs to include every engine
// the registry can ever advertise, which VOICE_ENGINES already tracks.
const KNOWN_ENGINE_IDS = new Set<string>(VOICE_ENGINES.map(({ value }) => value));

// The Voice Agent engine switcher polls this while a swap is in flight. The
// voice server restarts mid-switch, so an unreachable server is a normal
// transient state here, reported as such rather than as a 5xx.
export async function GET() {
  const status = await fetchVoiceHostEngineStatus();
  if (!status) {
    return NextResponse.json({ reachable: false });
  }
  return NextResponse.json({ reachable: true, ...status });
}

// Ask the voice server to swap the resident TTS engine (Classic presets,
// Custom dots.tts clones, or Trained GPT-SoVITS voices). Accepting the request
// is the success case; the swap itself takes minutes (service restarts, and
// some engines warm up for several more) and is followed via GET.
export async function POST(request: Request) {
  let engine: unknown;
  try {
    engine = ((await request.json()) as { engine?: unknown })?.engine;
  } catch {
    engine = undefined;
  }
  if (typeof engine !== "string" || !KNOWN_ENGINE_IDS.has(engine)) {
    return NextResponse.json(
      { error: `engine must be one of: ${[...KNOWN_ENGINE_IDS].join(", ")}` },
      { status: 400 },
    );
  }
  const result = await requestVoiceHostEngineSwitch(engine);
  if ("error" in result) {
    return NextResponse.json(
      { error: `The voice server did not accept the engine switch: ${result.error}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.payload as Record<string, unknown>) });
}
