import { NextResponse } from "next/server";
import { fetchVoiceHostCompanionStatus } from "../../../../lib/voice-host-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The companion device's state, summarised for the browser.
//
// Proxied rather than fetched client-side because reaching the voice server
// needs the dashboard's mTLS client identity, and that must never leave the
// server. The browser gets a shaped summary — no certificate material, no
// configuration secrets, and nothing about what any request was *about*.
//
// Read-only. Route changes go through the ordinary voice settings write, so
// there is one path that persists them and one signal that applies them.
export async function GET() {
  const status = await fetchVoiceHostCompanionStatus();
  return NextResponse.json(
    { voiceHost: { ok: status !== null }, status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
