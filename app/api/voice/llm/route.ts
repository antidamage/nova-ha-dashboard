import { NextResponse } from "next/server";
import {
  fetchVoiceHostLlmStatus,
  requestVoiceHostLlmSwitch,
} from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";

// The Voice Agent language model picker polls this while a switch is in
// flight. See specs/voice-llm-selector.md.
export async function GET() {
  const status = await fetchVoiceHostLlmStatus();
  if (!status) {
    return NextResponse.json({ reachable: false });
  }
  return NextResponse.json({ reachable: true, ...status });
}

// Ask the voice server to switch interpretation model. The model id is checked
// against the voice server's own registry; this only rejects a malformed body.
export async function POST(request: Request) {
  let llm: unknown;
  try {
    llm = ((await request.json()) as { llm?: unknown })?.llm;
  } catch {
    llm = undefined;
  }
  if (typeof llm !== "string" || !llm.trim()) {
    return NextResponse.json({ error: "llm must be a model id" }, { status: 400 });
  }
  const result = await requestVoiceHostLlmSwitch(llm);
  if ("error" in result) {
    if (result.status === 409) {
      // The voice host's reason is in the registry entry; the relay drops error bodies.
      const status = await fetchVoiceHostLlmStatus();
      const reason = status?.llms.find((entry) => entry.id === llm)?.unavailableReason;
      return NextResponse.json(
        { error: reason ?? "That model cannot run beside the current voice engine." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `The voice server did not accept the model switch: ${result.error}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, ...(result.payload as Record<string, unknown>) });
}
