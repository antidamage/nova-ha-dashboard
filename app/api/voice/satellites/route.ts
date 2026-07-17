import { NextResponse } from "next/server";
import {
  fetchIridiumSatelliteRegistry,
  triggerIridiumVoiceSettingsRefresh,
} from "../../../../lib/iridium-voice-settings";
import { assignVoiceSatelliteRoom, listVoiceSatelliteComputers } from "../../../../lib/voice-satellite-reconnect";
import { buildDashboardState } from "../../../../lib/ha";
import { indoorRoomOptions } from "../../../../lib/voice-rooms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Satellites are managed computers with the voiceSatellite capability; their
// live connection state comes from the voice server's registry, matched by
// satellite id (a satellite announces itself with its computer id). `rooms`
// is the same HA-area set the lighting sub-zones use, so the room dropdown
// always matches what the household actually calls each room.
export async function GET() {
  try {
    const [computers, registry, dashboardState] = await Promise.all([
      listVoiceSatelliteComputers(),
      fetchIridiumSatelliteRegistry(),
      buildDashboardState().catch(() => null),
    ]);
    return NextResponse.json({
      iridium: { ok: registry !== null },
      rooms: dashboardState ? indoorRoomOptions(dashboardState.zones) : [],
      satellites: computers.map((computer) => {
        const status = registry?.find((satellite) => satellite.satelliteId === computer.id) ?? null;
        return {
          configuredRoomId: computer.roomId || status?.roomId || "",
          enabled: computer.enabled,
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
    const body = (await request.json()) as { id?: unknown; roomId?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      throw new Error("Satellite id is required");
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
