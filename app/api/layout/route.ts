import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import type { LayoutPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";

// Apple TV layout preferences (the control-band height), merged into
// preferences.layout; the same value is surfaced live to the tvOS app on the
// /api/theme envelope (see app/api/theme/route.ts). The remote's swipe feel is
// learned on the TV and has no setting here.

const TV_HEIGHT_FRACTION_DEFAULT = 0.6;
const TV_HEIGHT_FRACTION_MIN = 0.3;
const TV_HEIGHT_FRACTION_MAX = 0.95;

function resolveTvHeightFraction(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(TV_HEIGHT_FRACTION_MAX, Math.max(TV_HEIGHT_FRACTION_MIN, raw))
    : TV_HEIGHT_FRACTION_DEFAULT;
}

function layoutResponse(layout: LayoutPreferences | undefined) {
  return {
    tvHeightFraction: resolveTvHeightFraction(layout?.tvHeightFraction),
  };
}

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ layout: layoutResponse(preferences.layout) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read layout settings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    const rawHeight = body?.tvHeightFraction;
    const heightUpdate =
      typeof rawHeight === "number" && Number.isFinite(rawHeight)
        ? resolveTvHeightFraction(rawHeight)
        : undefined;

    if (heightUpdate === undefined) {
      throw new Error("No layout settings provided");
    }

    const preferences = await readDashboardPreferences();
    const nextLayout: LayoutPreferences = {
      ...preferences.layout,
      ...(heightUpdate !== undefined ? { tvHeightFraction: heightUpdate } : {}),
    };

    await mergeDashboardPreferences({ layout: nextLayout });

    return NextResponse.json({ layout: layoutResponse(nextLayout) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update layout settings" },
      { status: 400 },
    );
  }
}
