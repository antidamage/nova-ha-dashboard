import { NextResponse } from "next/server";
import { parseAirconTimerUpdateRequest } from "../../../../lib/api/dashboard-requests";
import { publishDashboardState } from "../../../../lib/dashboard-events";
import { buildDashboardState } from "../../../../lib/ha";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../../lib/preferences";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const next = parseAirconTimerUpdateRequest(await request.json());

    await mergeDashboardPreferences({ panelHeater: { offTimerEndsAt: next.offTimerEndsAt } });
    try {
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish panel heater timer update", error);
    }

    const preferences = await readDashboardPreferences();
    return NextResponse.json({ panelHeater: preferences.panelHeater ?? {} });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update panel heater timer" },
      { status: 400 },
    );
  }
}
