import { commitRuleOperation, readRuleStore, ruleError } from "../../../../../lib/zone-light-rules-server";
import { deleteRule, updateRule, type ZoneLightRule } from "../../../../../lib/zone-light-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { rule?: Partial<ZoneLightRule> };
    const store = await readRuleStore();
    return commitRuleOperation(updateRule(store, decodeURIComponent(id), body.rule ?? {}), null);
  } catch (error) {
    return ruleError(error, "Failed to update lighting rule", 400);
  }
}

/** On and Off answer 403: they are built in. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const store = await readRuleStore();
    const ruleId = decodeURIComponent(id);
    const zoneId = store.rules.find((rule) => rule.id === ruleId)?.zoneId ?? null;
    return commitRuleOperation(deleteRule(store, ruleId), zoneId);
  } catch (error) {
    return ruleError(error, "Failed to delete lighting rule", 400);
  }
}
