import { NextResponse } from "next/server";
import { readDashboardBuildId } from "../../../lib/build-id";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      buildId: await readDashboardBuildId(),
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
