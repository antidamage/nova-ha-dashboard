import { NextResponse } from "next/server";
import {
  attributeOpenWashingMachineCycle,
  attributeWashingMachineCycle,
  readWashHistory,
  samplePowerNow,
  setWashingMachineCyclePerson,
} from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * One local day of the wash graph, plus every day that holds a wash so the
 * graph's buttons can skip the empty ones. `?block=<epoch ms>` names the day
 * to read; without it the newest day holding a wash is read.
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
 * Write one wash's owner. Two shapes, and the difference is deliberate:
 *
 * - `{ cycleId }` or `{ active: true }` alone **cycles** the attribution onward
 *   — unassigned → each configured person in order → unassigned. The panel's
 *   block is a tap, and the server owns the order so two screens cannot disagree
 *   about what comes next (specs/power-meters.md §4.3).
 * - `{ person }` **names** the person, `null` to clear it. That is the laundry
 *   history's dropdown, which picks rather than steps (§5.3). A key that is
 *   absent cycles; a key present and `null` clears, so the two are not the same
 *   request.
 *
 * A name this household does not configure is refused rather than written.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { active?: unknown; cycleId?: unknown; person?: unknown };
    if (body.person !== undefined && body.person !== null && typeof body.person !== "string") {
      return NextResponse.json({ error: "person must be a person id or null" }, { status: 400 });
    }
    const cycleId = typeof body.cycleId === "string" ? body.cycleId : null;
    if (body.active !== true && !cycleId) {
      return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
    }
    const cycle = body.person === undefined
      ? body.active === true
        ? await attributeOpenWashingMachineCycle()
        : await attributeWashingMachineCycle(cycleId!)
      : await setWashingMachineCyclePerson({
          active: body.active === true,
          ...(cycleId ? { cycleId } : {}),
          person: body.person,
        });
    if (!cycle) {
      return NextResponse.json({ error: body.active === true ? "No active wash" : "Unknown wash cycle" }, { status: 404 });
    }
    return NextResponse.json(await samplePowerNow(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to attribute the wash" },
      { status: 400 },
    );
  }
}
