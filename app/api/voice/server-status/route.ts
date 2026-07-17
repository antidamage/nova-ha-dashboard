import { NextResponse } from "next/server";
import { iridiumVoiceHostLabel, probeIridiumVoiceHealth } from "../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reachability probe for the voice server, polled every five seconds by the
// config page's status readout. Deliberately touches neither HA nor the
// satellite registry so the fast cadence stays cheap on both ends.
export async function GET() {
  const probe = await probeIridiumVoiceHealth();
  return NextResponse.json(
    { host: iridiumVoiceHostLabel(), checkedAt: new Date().toISOString(), ...probe },
    { headers: { "Cache-Control": "no-store" } },
  );
}
