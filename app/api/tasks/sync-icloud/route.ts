import { NextResponse } from "next/server";
import { getIcloudSyncStatus, syncIcloud } from "../../../../lib/icloud-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await syncIcloud();
    return NextResponse.json({ result, status: getIcloudSyncStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "iCloud sync failed",
        status: getIcloudSyncStatus(),
      },
      { status: 400 },
    );
  }
}
