import { NextResponse } from "next/server";
import { normalizeClimateTargetRange } from "../../../lib/climate-preferences";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";

export const dynamic = "force-dynamic";

/** The household knob range (specs/temperature-encoder.md). `range: null` = hard limits. */
export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ range: preferences.climateTargetRange ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read the knob range" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const range = normalizeClimateTargetRange(await request.json());
    // Written whole every time, so the top-level merge replacing it is correct.
    await mergeDashboardPreferences({ climateTargetRange: range });
    return NextResponse.json({ range });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save the knob range" }, { status: 400 });
  }
}
