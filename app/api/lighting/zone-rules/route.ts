import { NextResponse } from "next/server";
import { patchDashboardConfig } from "../../../../lib/dashboard-config";
import { commitRuleOperation, readRuleStore, ruleError, rulesPayload } from "../../../../lib/zone-light-rules-server";
import { createRule, type ZoneLightRule } from "../../../../lib/zone-light-rules";

/**
 * A zone's lighting rules: list (`?zoneId=` gives the effective list with the
 * built-in On and Off), create, and the lights an event may switch on. The
 * host fires the rules; nothing here schedules anything.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const zoneId = new URL(request.url).searchParams.get("zoneId");
    return NextResponse.json(await rulesPayload(await readRuleStore(), zoneId));
  } catch (error) {
    return ruleError(error, "Failed to read lighting rules");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { rule?: ZoneLightRule };
    const store = await readRuleStore();
    return commitRuleOperation(createRule(store, body.rule as ZoneLightRule), body.rule?.zoneId ?? null);
  } catch (error) {
    return ruleError(error, "Failed to create lighting rule", 400);
  }
}

/** Replaces the switch-on list (config arrays replace rather than merge). */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { switchOnEntityIds?: string[] };
    if (!Array.isArray(body.switchOnEntityIds)) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const result = await patchDashboardConfig({ dashboard: { lighting: { eventSwitchOnEntityIds: body.switchOnEntityIds } } });
    if (!result.ok) {
      return NextResponse.json({ error: result.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ") }, { status: 400 });
    }
    return NextResponse.json({ switchOnEntityIds: result.config.dashboard.lighting.eventSwitchOnEntityIds ?? [] });
  } catch (error) {
    return ruleError(error, "Failed to update lighting rules", 400);
  }
}
