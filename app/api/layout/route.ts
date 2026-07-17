import { NextResponse } from "next/server";
import { appleTvSwipeUpdateFrom, normalizeAppleTvSwipe } from "../../../lib/appletv-swipe";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import type { LayoutPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";

// Apple TV layout/interaction preferences (the control-band height plus the
// swipe-stickiness tuning). Read by the "Apple TV Expert Settings" config section
// and merged into preferences.layout; the same values are surfaced live to the
// tvOS app on the /api/theme envelope (see app/api/theme/route.ts).

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
    swipe: normalizeAppleTvSwipe(layout?.swipe),
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
    const swipeUpdate = appleTvSwipeUpdateFrom(body?.swipe);
    const rawHeight = body?.tvHeightFraction;
    const heightUpdate =
      typeof rawHeight === "number" && Number.isFinite(rawHeight)
        ? resolveTvHeightFraction(rawHeight)
        : undefined;

    if (!swipeUpdate && heightUpdate === undefined) {
      throw new Error("No layout settings provided");
    }

    const preferences = await readDashboardPreferences();
    // Merge field-by-field so changing one knob never drops the others, and
    // re-normalize so the stored value is always complete and in range.
    const nextLayout: LayoutPreferences = {
      ...preferences.layout,
      ...(heightUpdate !== undefined ? { tvHeightFraction: heightUpdate } : {}),
      ...(swipeUpdate
        ? { swipe: normalizeAppleTvSwipe({ ...preferences.layout?.swipe, ...swipeUpdate }) }
        : {}),
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
