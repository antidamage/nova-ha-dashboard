import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { activeDesignId, normalizeDesignPreferences } from "../../../lib/design-preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json(
      { activeId: activeDesignId(preferences), updatedAt: preferences.designUpdatedAt ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read the active design" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    const next = normalizeDesignPreferences(body);
    const updatedAt = new Date().toISOString();
    // The whole object is sent every time, so the top-level spread in
    // mergeDashboardPreferences is the correct merge here — there are no
    // sibling keys under `design` for it to clobber.
    await mergeDashboardPreferences({ design: next, designUpdatedAt: updatedAt });
    return NextResponse.json({ activeId: next.activeId, updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the active design" },
      { status: 400 },
    );
  }
}
