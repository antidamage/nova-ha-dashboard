import { NextResponse } from "next/server";
import { attributeWashingMachineCycle, samplePowerNow } from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Cycle one wash's attribution onward: unassigned → each configured person in
 * order → unassigned (specs/power-meters.md §4.3).
 *
 * The client sends the cycle id only. The server owns the order, so two screens
 * tapping the same block cannot disagree about what comes next.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cycleId?: unknown };
    const cycleId = typeof body.cycleId === "string" ? body.cycleId : null;
    if (!cycleId) {
      return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
    }
    const cycle = await attributeWashingMachineCycle(cycleId);
    if (!cycle) {
      return NextResponse.json({ error: "Unknown wash cycle" }, { status: 404 });
    }
    return NextResponse.json(await samplePowerNow(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to attribute the wash" },
      { status: 400 },
    );
  }
}
