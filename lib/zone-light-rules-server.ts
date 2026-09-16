import { NextResponse } from "next/server";
import { patchDashboardConfig, readDashboardConfig } from "./dashboard-config";
import { ensureZoneLightRulesMigrated } from "./ha";
import { effectiveZoneRules, storeFromLighting, type RuleOperationResult, type ZoneLightRuleStore } from "./zone-light-rules";

/** Host side of the zone light rules API (specs/zone-light-events.md). */

export async function readRuleStore(): Promise<ZoneLightRuleStore> {
  try {
    await ensureZoneLightRulesMigrated();
  } catch (error) {
    console.error("[nova-dashboard] zone light rule migration failed", { error });
  }
  const config = await readDashboardConfig();
  return storeFromLighting(config.dashboard.lighting);
}

export async function rulesPayload(store: ZoneLightRuleStore, zoneId: string | null) {
  const config = await readDashboardConfig();
  return {
    rules: zoneId ? effectiveZoneRules(store, zoneId) : store.rules,
    seededZoneIds: store.seededZoneIds,
    switchOnEntityIds: config.dashboard.lighting.eventSwitchOnEntityIds ?? [],
  };
}

/** Persist an operation's store, or answer with its error. */
export async function commitRuleOperation(result: RuleOperationResult, zoneId: string | null) {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const written = await patchDashboardConfig({
    dashboard: { lighting: { zoneRules: result.store.rules, zoneRulesSeededZoneIds: result.store.seededZoneIds } },
  });
  if (!written.ok) {
    return NextResponse.json({ error: written.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ") }, { status: 400 });
  }
  const store = storeFromLighting(written.config.dashboard.lighting);
  return NextResponse.json({ ...(await rulesPayload(store, zoneId ?? result.rule?.zoneId ?? null)), rule: result.rule ?? null });
}

export function ruleError(error: unknown, fallback: string, status = 500) {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}
