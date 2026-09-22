import { NextResponse } from "next/server";
import {
  attributeOpenWashingMachineCycle,
  attributeWashingMachineCycle,
  readWashHistory,
  samplePowerNow,
} from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * One 12-hour block of the wash graph, plus every block that holds a wash so the
 * graph's buttons can skip the empty ones. `?block=<epoch ms>` names the block
 * to read; without it the newest block holding a wash is read.
 * See specs/power-meters.md §5.2.
 */
export async function GET(request: Request) {
  try {
    const param = new URL(request.url).searchParams.get("block");
    const atMs = param === null ? null : Number(param);
    if (atMs !== null && !Number.isFinite(atMs)) {
      return NextResponse.json({ error: "block must be an epoch-ms instant" }, { status: 400 });
    }
    const history = await readWashHistory(atMs);
    if (!history) {
      return NextResponse.json({ error: "No washing machine configured" }, { status: 404 });
    }
    return NextResponse.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the wash history" },
      { status: 500 },
    );
  }
}

/**
 * Cycle one wash's attribution onward: unassigned → each configured person in
 * order → unassigned (specs/power-meters.md §4.3).
 *
 * The client sends the cycle id only. The server owns the order, so two screens
 * tapping the same block cannot disagree about what comes next.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { active?: unknown; cycleId?: unknown };
    if (body.active === true) {
      const cycle = await attributeOpenWashingMachineCycle();
      if (!cycle) return NextResponse.json({ error: "No active wash" }, { status: 404 });
      return NextResponse.json(await samplePowerNow(), { headers: { "Cache-Control": "no-store" } });
    }
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
