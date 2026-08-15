import { NextResponse } from "next/server";
import { voiceHostLabel, probeVoiceHostHealth } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reachability probe for the voice server, polled every five seconds by the
// config page's status readout. Deliberately touches neither HA nor the
// satellite registry so the fast cadence stays cheap on both ends.
export async function GET() {
  const probe = await probeVoiceHostHealth();
  return NextResponse.json(
    { host: voiceHostLabel(), checkedAt: new Date().toISOString(), ...probe },
    { headers: { "Cache-Control": "no-store" } },
  );
}
