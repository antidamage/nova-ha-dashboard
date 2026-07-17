import { NextResponse } from "next/server";
import { parseWatchfaceUpdateRequest } from "../../../lib/api/dashboard-requests";
import { publishDashboardState } from "../../../lib/dashboard-events";
import { buildDashboardState } from "../../../lib/ha";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { normalizedWatchfacePreferences } from "../../../lib/watchface-preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ watchface: normalizedWatchfacePreferences(preferences) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read watchface settings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const next = parseWatchfaceUpdateRequest(await request.json());

    await mergeDashboardPreferences({ watchface: next });
    try {
      publishDashboardState(await buildDashboardState(), { force: true });
    } catch (error) {
      console.error("[nova-dashboard] failed to publish watchface settings update", error);
    }
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ watchface: normalizedWatchfacePreferences(preferences) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update watchface settings" },
      { status: 400 },
    );
  }
}
