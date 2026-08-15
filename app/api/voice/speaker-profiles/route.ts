import { NextResponse } from "next/server";
import { fetchVoiceHostSpeakerProfiles } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const profiles = await fetchVoiceHostSpeakerProfiles();
  if (!profiles) {
    return NextResponse.json({ error: "Speaker profiles are unavailable" }, { status: 502 });
  }
  return NextResponse.json(profiles, { headers: { "Cache-Control": "no-store" } });
}
