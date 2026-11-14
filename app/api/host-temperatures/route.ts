import { NextResponse } from "next/server";
import { hostTemperatures } from "../../../lib/host-temperatures/server";

// specs/host-temperature-gauges.md: the configured machines' CPU/GPU temperatures.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await hostTemperatures(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read host temperatures" },
      { status: 500 },
    );
  }
}
