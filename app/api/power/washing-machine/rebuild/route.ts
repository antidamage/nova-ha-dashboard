import { NextResponse } from "next/server";
import { rebuildWashingMachineHistory } from "../../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Rebuild washes missing from the store out of the meter's Home Assistant
 * history between `from` and `to` (specs/power-meters.md §7.5). Stored cycles
 * and their attribution are never changed; the store is backed up first.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { from?: unknown; to?: unknown };
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }
    const result = await rebuildWashingMachineHistory(body.from, body.to);
    if (!result) {
      return NextResponse.json({ error: "No washing machine configured" }, { status: 404 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild washes" },
      { status: 400 },
    );
  }
}
