import { NextResponse } from "next/server";
import { dashboardSecretStatus, saveDashboardSecret } from "../../../../lib/dashboard-secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Secrets configured from the config page rather than the host environment.
// GET never returns a stored value in full - only whether it is set and a
// shortened preview - so a config screen left open on a wall display cannot
// leak a webhook token.
export async function GET() {
  try {
    return NextResponse.json(await dashboardSecretStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read dashboard secrets" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    const record = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    if (!("themeChangeNotificationUrl" in record)) {
      throw new Error("No known secret was supplied");
    }
    // An empty string clears it; the config page's Clear action posts exactly
    // that rather than needing a DELETE.
    return NextResponse.json(
      await saveDashboardSecret("themeChangeNotificationUrl", record.themeChangeNotificationUrl ?? ""),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save dashboard secret" },
      { status: 400 },
    );
  }
}
