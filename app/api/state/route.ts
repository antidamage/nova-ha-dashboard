import { NextResponse } from "next/server";
import { publishDashboardState, withDashboardEventMetadata } from "../../../lib/dashboard-events";
import { buildDashboardState } from "../../../lib/ha";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = withDashboardEventMetadata(await buildDashboardState());
    publishDashboardState(state);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read Home Assistant state" },
      { status: 500 },
    );
  }
}
