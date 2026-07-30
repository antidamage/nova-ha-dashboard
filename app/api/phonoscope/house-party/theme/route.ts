import { NextResponse } from "next/server";
import { housePartyThemeRuntimeState } from "../../../../../lib/house-party-coordinator";
import { readDashboardPreferences } from "../../../../../lib/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const preferences = await readDashboardPreferences();
  return NextResponse.json({
    followVisualizerWhenActive: preferences.followVisualizerWhenActive === true,
    ...housePartyThemeRuntimeState(),
  });
}
