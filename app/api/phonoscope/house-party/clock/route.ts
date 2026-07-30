import { NextResponse } from "next/server";
import { housePartyClockRuntimeState } from "../../../../../lib/house-party-coordinator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(housePartyClockRuntimeState(), {
    headers: { "Cache-Control": "no-store" },
  });
}
