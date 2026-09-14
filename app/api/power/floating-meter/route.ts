import { NextResponse } from "next/server";
import { samplePowerNow, setFloatingMeterCategory } from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Move the floating meter onto another group (specs/power-meters.md §3.2).
 *
 * This is server state, not a preference: it describes where a physical plug
 * is, and the estimator reads it on every sample. The reply carries a fresh
 * sample so the panel does not have to wait out its poll to show the change.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { categoryId?: unknown };
    const categoryId = typeof body.categoryId === "string" ? body.categoryId : null;
    if (!categoryId) {
      return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
    }
    const applied = await setFloatingMeterCategory(categoryId);
    if (!applied) {
      return NextResponse.json({ error: "Unknown floating-meter category" }, { status: 404 });
    }
    return NextResponse.json(await samplePowerNow(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to move the floating meter" },
      { status: 400 },
    );
  }
}
