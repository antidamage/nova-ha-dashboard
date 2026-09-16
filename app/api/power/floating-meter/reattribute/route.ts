import { NextResponse } from "next/server";
import { reattributeFloatingMeterHistory } from "../../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Move one floating-meter category's hourly history, up to `until`, onto
 * another category (specs/power-meters.md §7.5). The power state is backed up
 * first; running it again moves nothing.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { fromCategoryId?: unknown; toCategoryId?: unknown; until?: unknown };
    const { fromCategoryId, toCategoryId, until } = body;
    if (typeof fromCategoryId !== "string" || typeof toCategoryId !== "string" || typeof until !== "string") {
      return NextResponse.json({ error: "fromCategoryId, toCategoryId and until are required" }, { status: 400 });
    }
    const result = await reattributeFloatingMeterHistory(fromCategoryId, toCategoryId, until);
    if (!result) {
      return NextResponse.json({ error: "Unknown floating-meter category" }, { status: 404 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reattribute floating-meter history" },
      { status: 400 },
    );
  }
}
