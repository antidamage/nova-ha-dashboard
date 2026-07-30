import { NextResponse } from "next/server";
import { startHousePartySession } from "../../../../../lib/house-party-coordinator";
import { captureHousePartyLightingRestore } from "../../../../../lib/ha";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const restore = await captureHousePartyLightingRestore();
  return NextResponse.json(startHousePartySession(restore), { status: 201 });
}
