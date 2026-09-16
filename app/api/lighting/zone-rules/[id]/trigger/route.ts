import { NextResponse } from "next/server";
import { triggerZoneLightRule } from "../../../../../../lib/ha";
import { readRuleStore, ruleError } from "../../../../../../lib/zone-light-rules-server";
import { findRule } from "../../../../../../lib/zone-light-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Apply one rule now, as pressing its preset button does. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const rule = findRule(await readRuleStore(), decodeURIComponent(id));
    if (!rule) {
      return NextResponse.json({ error: `Unknown rule: ${id}` }, { status: 404 });
    }
    await triggerZoneLightRule(rule);
    return NextResponse.json({ triggered: rule.id });
  } catch (error) {
    return ruleError(error, "Failed to trigger lighting rule");
  }
}
