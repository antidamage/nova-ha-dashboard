import { NextResponse } from "next/server";
import { fetchIridiumSpeakerProfiles } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const profiles = await fetchIridiumSpeakerProfiles();
  if (!profiles) {
    return NextResponse.json({ error: "Speaker profiles are unavailable" }, { status: 502 });
  }
  return NextResponse.json(profiles, { headers: { "Cache-Control": "no-store" } });
}
