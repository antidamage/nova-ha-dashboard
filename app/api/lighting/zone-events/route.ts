import { NextResponse } from "next/server";
import { patchDashboardConfig, readDashboardConfig } from "../../../../lib/dashboard-config";
import type { ZoneLightEvent } from "../../../../lib/types";

/**
 * The zone light events a dashboard can read and edit. The rules themselves
 * live in the host's config and are fired by the host poller — nothing here
 * schedules anything (specs/zone-light-events.md).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const config = await readDashboardConfig();
    return NextResponse.json({
      events: config.dashboard.lighting.zoneEvents ?? [],
      switchOnEntityIds: config.dashboard.lighting.eventSwitchOnEntityIds ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read light events" },
      { status: 500 },
    );
  }
}

/**
 * Replaces the whole list, because config arrays replace rather than merge.
 * The caller sends the list it wants; validation is the config schema's.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as {
      events?: ZoneLightEvent[];
      switchOnEntityIds?: string[];
    };
    const lighting: Record<string, unknown> = {};
    if (Array.isArray(body.events)) lighting.zoneEvents = body.events;
    if (Array.isArray(body.switchOnEntityIds)) lighting.eventSwitchOnEntityIds = body.switchOnEntityIds;
    if (!Object.keys(lighting).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const result = await patchDashboardConfig({ dashboard: { lighting } });
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ") }, { status: 400 });
    }

    return NextResponse.json({
      events: result.config.dashboard.lighting.zoneEvents ?? [],
      switchOnEntityIds: result.config.dashboard.lighting.eventSwitchOnEntityIds ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update light events" },
      { status: 400 },
    );
  }
}
