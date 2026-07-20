import { NextResponse } from "next/server";
import {
  fetchIridiumSatelliteRegistry,
  triggerIridiumVoiceSettingsRefresh,
} from "../../../../lib/iridium-voice-settings";
import { assignVoiceSatelliteRoom, listVoiceSatelliteComputers } from "../../../../lib/voice-satellite-reconnect";
import { buildDashboardState } from "../../../../lib/ha";
import { indoorRoomOptions } from "../../../../lib/voice-rooms";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../../lib/preferences";
import { normalizeVoiceSettings } from "../../../../lib/voice-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The per-satellite killswitch rides on the voice settings (the same contract
// Iridium pulls), so a disabled satellite's mic frames are dropped server-side.
async function disabledSatelliteIds(): Promise<string[]> {
  try {
    const preferences = await readDashboardPreferences();
    return normalizeVoiceSettings(preferences.voice).disabledSatellites;
  } catch {
    return [];
  }
}

async function setSatelliteVoiceEnabled(id: string, voiceEnabled: boolean): Promise<string[]> {
  const lowerId = id.toLowerCase();
  const current = await disabledSatelliteIds();
  const next = voiceEnabled
    ? current.filter((satellite) => satellite !== lowerId)
    : current.includes(lowerId)
      ? current
      : [...current, lowerId];
  await mergeDashboardPreferences({ voice: { disabledSatellites: next } });
  // Iridium pulls the voice settings on this signal and applies the gate live.
  await triggerIridiumVoiceSettingsRefresh().catch(() => undefined);
  return next;
}

// Satellites are managed computers with the voiceSatellite capability; their
// live connection state comes from the voice server's registry, matched by
// satellite id (a satellite announces itself with its computer id). `rooms`
// is the same HA-area set the lighting sub-zones use, so the room dropdown
// always matches what the household actually calls each room.
export async function GET() {
  try {
    const [computers, registry, dashboardState, disabled] = await Promise.all([
      listVoiceSatelliteComputers(),
      fetchIridiumSatelliteRegistry(),
      buildDashboardState().catch(() => null),
      disabledSatelliteIds(),
    ]);
    return NextResponse.json({
      iridium: { ok: registry !== null },
      rooms: dashboardState ? indoorRoomOptions(dashboardState.zones) : [],
      satellites: computers.map((computer) => {
        const status = registry?.find((satellite) => satellite.satelliteId === computer.id) ?? null;
        return {
          configuredRoomId: computer.roomId || status?.roomId || "",
          enabled: computer.enabled,
          // Per-satellite killswitch state (distinct from `enabled`, the SSH
          // management gate): false means this satellite's mic is switched off.
          voiceEnabled: !disabled.includes(computer.id.toLowerCase()),
          id: computer.id,
          name: computer.name,
          platform: computer.platform,
          status,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list voice satellites" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      roomId?: unknown;
      voiceEnabled?: unknown;
    };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      throw new Error("Satellite id is required");
    }
    if (typeof body.voiceEnabled === "boolean") {
      const disabledSatellites = await setSatelliteVoiceEnabled(id, body.voiceEnabled);
      return NextResponse.json({ id, voiceEnabled: body.voiceEnabled, disabledSatellites });
    }
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    const result = await assignVoiceSatelliteRoom(id, roomId);
    // The voice server treats the roster as the room authority (it pulls
    // satelliteRooms with the voice settings); refresh it so the assignment
    // applies when the restarted satellite reconnects.
    await triggerIridiumVoiceSettingsRefresh().catch(() => undefined);
    return NextResponse.json({
      computer: result.computer,
      pushError: result.pushError,
      pushed: result.pushed,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assign the satellite's room" },
      { status: 400 },
    );
  }
}
