import { NextResponse } from "next/server";
import { normalizeAgentSettings } from "../../../lib/agent-settings";
import { triggerVoiceHostSettingsRefresh } from "../../../lib/voice-host-settings";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { listVoiceSatelliteComputers } from "../../../lib/voice-satellite-reconnect";
import { normalizeVoiceSettings, parseVoiceSettingsUpdate } from "../../../lib/voice-settings";

export const dynamic = "force-dynamic";

// The roster's room assignments ride along with the voice settings because
// voice host pulls this contract: the dashboard is authoritative for satellite
// rooms, and a satellite's own env-file room is only a fallback.
async function satelliteRoomAssignments(): Promise<Record<string, string>> {
  try {
    const computers = await listVoiceSatelliteComputers();
    return Object.fromEntries(
      computers
        .filter((computer) => computer.roomId)
        .map((computer) => [computer.id, computer.roomId as string]),
    );
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({
      agent: normalizeAgentSettings(preferences.agent),
      voice: {
        ...normalizeVoiceSettings(preferences.voice),
        satelliteRooms: await satelliteRoomAssignments(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read voice settings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const update = parseVoiceSettingsUpdate(await request.json());

    // Nova is the durable source of truth. voice host receives only a collection
    // signal, then pulls this same API contract before applying it live.
    // Keep this merge partial: concurrent knob changes are serialized by the
    // preferences write queue without either request replacing the other knobs.
    await mergeDashboardPreferences({ voice: update });
    const voiceHost = await triggerVoiceHostSettingsRefresh();
    const saved = await readDashboardPreferences();

    return NextResponse.json({
      voice: normalizeVoiceSettings(saved.voice),
      voiceHost,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update voice settings" },
      { status: 400 },
    );
  }
}
