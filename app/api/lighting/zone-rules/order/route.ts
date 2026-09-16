import { NextResponse } from "next/server";
import { commitRuleOperation, readRuleStore, ruleError } from "../../../../../lib/zone-light-rules-server";
import { reorderRules } from "../../../../../lib/zone-light-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Set a zone's preset order from `{ zoneId, ids }`; On and Off stay at the ends. */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { zoneId?: string; ids?: string[] };
    if (!body.zoneId || !Array.isArray(body.ids)) {
      return NextResponse.json({ error: "zoneId and ids are required" }, { status: 400 });
    }
    return commitRuleOperation(reorderRules(await readRuleStore(), body.zoneId, body.ids), body.zoneId);
  } catch (error) {
    return ruleError(error, "Failed to reorder lighting rules", 400);
  }
}
