import { NextResponse } from "next/server";
import { buildDashboardState } from "../../../../../../lib/ha";
import { mergeDashboardPreferences } from "../../../../../../lib/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ zoneId: string }> }) {
  try {
    const { zoneId } = await context.params;
    const body = await request.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const state = await buildDashboardState();
    const zone = state.zones.find((candidate) => candidate.id === zoneId && !candidate.special);
    if (!zone || !zone.entities.some((entity) => entity.domain === "light")) {
      return NextResponse.json({ error: "Unknown lighting zone" }, { status: 404 });
    }
    await mergeDashboardPreferences({
      lighting: {
        housePartyZones: {
          [zoneId]: { enabled: body.enabled, updatedAt: new Date().toISOString() },
        },
      },
    });
    return NextResponse.json({ zoneId, enabled: body.enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update House Party zone" }, { status: 400 });
  }
}
