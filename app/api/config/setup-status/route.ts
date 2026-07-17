import { NextResponse } from "next/server";
import { readSecretSetupStatus } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readSecretSetupStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read setup status" },
      { status: 500 },
    );
  }
}
