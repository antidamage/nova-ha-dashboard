import { NextResponse } from "next/server";
import { parseAirconTargetUpdateRequest } from "../../../../lib/api/dashboard-requests";
import { publishDashboardState } from "../../../../lib/dashboard-events";
import { buildDashboardState } from "../../../../lib/ha";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { applyClimateControlIntent } from "../../../../lib/climate-control";
import { attributeControl } from "../../../../lib/control-attribution";

export const dynamic = "force-dynamic";

/**
 * Remembers a target temperature without commanding the unit.
 *
 * The knob sets the target in every mode, Off included
 * (specs/temperature-encoder.md), and in Off there is nothing to tell the air
 * conditioner: the value is what the next start uses. `set_temperature` on a
 * unit that is off would be a command to a device the owner has switched off.
 */
export async function POST(request: Request) {
  try {
    const next = parseAirconTargetUpdateRequest(await request.json());

    await applyClimateControlIntent({ room: "lounge", temperature: next.temperature });
    try {
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish aircon target update", error);
    }

    const preferences = await readDashboardPreferences();
    void attributeControl(request, {
      service: "climate",
      event: "aircon-target",
      summary: `Aircon target ${next.temperature} degrees`,
      detail: { route: "/api/aircon/target", temperature: next.temperature },
    });
    return NextResponse.json({ aircon: preferences.aircon ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update aircon target" },
      { status: 400 },
    );
  }
}
