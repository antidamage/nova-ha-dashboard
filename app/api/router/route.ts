import { NextResponse } from "next/server";
import { buildRouterStatusOnly } from "../../../lib/ha";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildRouterStatusOnly(), {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read router state" },
      { status: 500 },
    );
  }
}
