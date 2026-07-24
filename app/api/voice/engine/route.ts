import { NextResponse } from "next/server";
import {
  fetchIridiumEngineStatus,
  requestIridiumEngineSwitch,
} from "../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";

// The Voice Agent engine switcher polls this while a swap is in flight. The
// voice server restarts mid-switch, so an unreachable server is a normal
// transient state here, reported as such rather than as a 5xx.
export async function GET() {
  const status = await fetchIridiumEngineStatus();
  if (!status) {
    return NextResponse.json({ reachable: false });
  }
  return NextResponse.json({ reachable: true, ...status });
}

// Ask the voice server to swap the resident TTS engine (classic Qwen presets
// vs custom dots.tts clones). Accepting the request is the success case; the
// swap itself takes minutes (service restarts, and the custom engine warms up
// for ~7 minutes) and is followed via GET.
export async function POST(request: Request) {
  let engine: unknown;
  try {
    engine = ((await request.json()) as { engine?: unknown })?.engine;
  } catch {
    engine = undefined;
  }
  if (engine !== "classic" && engine !== "custom") {
    return NextResponse.json({ error: "engine must be \"classic\" or \"custom\"" }, { status: 400 });
  }
  const result = await requestIridiumEngineSwitch(engine);
  if ("error" in result) {
    return NextResponse.json(
      { error: `The voice server did not accept the engine switch: ${result.error}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.payload as Record<string, unknown>) });
}
