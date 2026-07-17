import { NextResponse } from "next/server";
import { getIcloudSyncStatus } from "../../../../lib/icloud-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getIcloudSyncStatus());
}
