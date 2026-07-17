import { NextResponse } from "next/server";
import { getUpdateStatus } from "../../../lib/update";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      await getUpdateStatus(),
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read update status" },
      { status: 500 },
    );
  }
}
