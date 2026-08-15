import { NextResponse } from "next/server";
import { fetchVoiceHostCompanionRoutes } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Where each reasoning pass is running *right now*, according to the voice
// server. The stored dashboard preference is only the passes someone has
// chosen; everything else is on the voice server's own default, and this is
// what stops the dropdowns claiming otherwise.
//
// Read-only on purpose: changes go through the ordinary voice settings write,
// so one path persists them and one signal applies them.
export async function GET() {
  const routes = await fetchVoiceHostCompanionRoutes();
  return NextResponse.json(
    { voiceHost: { ok: routes !== null }, routes: routes ?? {} },
    { headers: { "Cache-Control": "no-store" } },
  );
}
