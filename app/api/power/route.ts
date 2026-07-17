import { NextResponse } from "next/server";
import { ensurePowerMonitorStarted, samplePowerNow } from "../../../lib/power";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensurePowerMonitorStarted();
    return NextResponse.json(await samplePowerNow(), {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read power state" },
      { status: 500 },
    );
  }
}
