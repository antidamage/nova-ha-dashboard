import { NextResponse } from "next/server";
import { parseOrbInfoUpdateRequest } from "../../../lib/api/dashboard-requests";
import { publishDashboardState } from "../../../lib/dashboard-events";
import { buildDashboardState } from "../../../lib/ha";
import { normalizedOrbInfoPreferences } from "../../../lib/orb-info/preferences";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ orbInfo: normalizedOrbInfoPreferences(preferences.orbInfo) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read status orb info settings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const next = parseOrbInfoUpdateRequest(await request.json());

    await mergeDashboardPreferences({ orbInfo: next });
    try {
      // The Apple TV reads its orb config off the shared dashboard state, so a
      // change here has to be pushed rather than waiting for the next snapshot.
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish status orb info update", error);
    }
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ orbInfo: normalizedOrbInfoPreferences(preferences.orbInfo) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update status orb info settings" },
      { status: 400 },
    );
  }
}
