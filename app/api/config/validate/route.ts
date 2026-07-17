import { NextResponse } from "next/server";
import { dryRunDashboardConfigImport } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await dryRunDashboardConfigImport(body.config ?? body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to validate dashboard config" },
      { status: 400 },
    );
  }
}
