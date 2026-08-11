import { NextResponse } from "next/server";
import { parseAirconTimerUpdateRequest } from "../../../../lib/api/dashboard-requests";
import { publishDashboardState } from "../../../../lib/dashboard-events";
import { buildDashboardState } from "../../../../lib/ha";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { applyClimateControlIntent } from "../../../../lib/climate-control";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const next = parseAirconTimerUpdateRequest(await request.json());

    await applyClimateControlIntent({ room: "lounge", offTimerEndsAt: next.offTimerEndsAt });
    try {
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish aircon timer update", error);
    }

    const preferences = await readDashboardPreferences();
    return NextResponse.json({ aircon: preferences.aircon ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update aircon timer" },
      { status: 400 },
    );
  }
}
