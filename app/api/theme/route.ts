import { NextResponse } from "next/server";
import { normalizeAppleTvSwipe } from "../../../lib/appletv-swipe";
import { parseThemeUpdateRequest } from "../../../lib/api/dashboard-requests";
import { readDashboardConfig } from "../../../lib/dashboard-config";
import { resolveThemeVariant } from "../../../lib/managed-desktop-sync";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { hasThemeNamespace, mergeLegacyThemeUpdate, themeResponseValue } from "../../../lib/theme-values";
import type { LayoutPreferences } from "../../../lib/types";

export const dynamic = "force-dynamic";

// Apple TV control-band height as a fraction of the screen. Lives on the theme
// envelope (not per dark/light variant) so the tvOS app can tune it live.
const TV_HEIGHT_FRACTION_DEFAULT = 0.6;
const TV_HEIGHT_FRACTION_MIN = 0.3;
const TV_HEIGHT_FRACTION_MAX = 0.95;

function resolveLayout(layout: LayoutPreferences | undefined) {
  const raw = layout?.tvHeightFraction;
  const fraction =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(TV_HEIGHT_FRACTION_MAX, Math.max(TV_HEIGHT_FRACTION_MIN, raw))
      : TV_HEIGHT_FRACTION_DEFAULT;
  // Always emit a fully-populated swipe block so the tvOS app gets every knob
  // (filling unset fields from the shared defaults).
  return { tvHeightFraction: fraction, swipe: normalizeAppleTvSwipe(layout?.swipe) };
}

function layoutUpdateFrom(value: unknown): LayoutPreferences | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = (value as Record<string, unknown>).tvHeightFraction;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return { tvHeightFraction: Math.min(TV_HEIGHT_FRACTION_MAX, Math.max(TV_HEIGHT_FRACTION_MIN, raw)) };
}

export async function GET(request: Request) {
  try {
    const preferences = await readDashboardPreferences();
    const config = await readDashboardConfig();
    const theme = themeResponseValue(preferences.theme, config.dashboard.avatar);

    // `?variant=resolved` flattens the dark/light envelope server-side. The GPU
    // visualiser needs the theme for its fluid backdrop, and resolving
    // `selection: "auto"` requires the sun state, which only this side has.
    // Doing it here keeps one implementation of the rule rather than a second
    // one in C++.
    if (new URL(request.url).searchParams.get("variant") === "resolved" && theme) {
      const themeSet = theme as Record<string, unknown>;
      const variant = await resolveThemeVariant(themeSet);
      const variants = (themeSet.themes ?? {}) as Record<string, unknown>;
      const resolved = (variants[variant] ?? variants.dark ?? variants.light ?? null) as
        | Record<string, unknown>
        | null;
      return NextResponse.json(
        {
          variant,
          theme: resolved,
          updatedAt: preferences.themeUpdatedAt ?? null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({
      followVisualizerWhenActive: preferences.followVisualizerWhenActive === true,
      theme,
      layout: resolveLayout(preferences.layout),
      updatedAt: preferences.themeUpdatedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read shared theme" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const nextTheme = bodyRecord.theme === undefined
      ? undefined
      : parseThemeUpdateRequest(body).theme;
    const followVisualizerWhenActive = typeof bodyRecord.followVisualizerWhenActive === "boolean"
      ? bodyRecord.followVisualizerWhenActive
      : undefined;
    if (!nextTheme && followVisualizerWhenActive === undefined) {
      throw new Error("A shared theme or visualiser-follow setting is required");
    }
    const layoutUpdate = layoutUpdateFrom((body as Record<string, unknown> | null)?.layout);

    const preferences = await readDashboardPreferences();
    const config = await readDashboardConfig();
    const currentTheme = themeResponseValue(preferences.theme, config.dashboard.avatar) ?? {};
    const theme = nextTheme
      ? hasThemeNamespace(nextTheme)
        ? themeResponseValue(nextTheme, config.dashboard.avatar) ?? nextTheme
        : mergeLegacyThemeUpdate(currentTheme, nextTheme)
      : currentTheme;
    const updatedAt = new Date().toISOString();
    await mergeDashboardPreferences({
      ...(nextTheme ? { theme, themeUpdatedAt: updatedAt } : {}),
      ...(followVisualizerWhenActive !== undefined ? { followVisualizerWhenActive } : {}),
      ...(layoutUpdate ? { layout: { ...preferences.layout, ...layoutUpdate } } : {}),
    });
    // Saving a theme no longer pushes wallpapers to managed desktops. That now
    // happens only when the user leaves config ("Back") or when the dashboard
    // flips dark/light, both of which run the deduplicated sync explicitly.

    return NextResponse.json({
      followVisualizerWhenActive: followVisualizerWhenActive ?? (preferences.followVisualizerWhenActive === true),
      theme,
      layout: resolveLayout(layoutUpdate ? { ...preferences.layout, ...layoutUpdate } : preferences.layout),
      updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update shared theme" },
      { status: 400 },
    );
  }
}
