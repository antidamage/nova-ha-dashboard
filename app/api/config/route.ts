import { NextResponse } from "next/server";
import { exportDashboardConfig, readSecretSetupStatus, writeDashboardConfig } from "../../../lib/dashboard-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [config, secrets] = await Promise.all([exportDashboardConfig(), readSecretSetupStatus()]);
    return NextResponse.json({ config, secrets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read dashboard config" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const result = await writeDashboardConfig(body.config ?? body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update dashboard config" },
      { status: 400 },
    );
  }
}
