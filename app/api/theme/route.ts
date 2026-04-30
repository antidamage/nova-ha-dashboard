import { NextResponse } from "next/server";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function sharedThemeValue(value: unknown) {
  const theme = recordValue(value);
  if (!theme) {
    return null;
  }

  const { autoFullscreenOnLoad: _localOnly, ...sharedTheme } = theme;
  return sharedTheme;
}

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({
      theme: sharedThemeValue(preferences.theme),
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
    const theme = sharedThemeValue(body.theme);

    if (!theme) {
      throw new Error("Shared theme must be an object");
    }

    const updatedAt = new Date().toISOString();
    await mergeDashboardPreferences({ theme, themeUpdatedAt: updatedAt });

    return NextResponse.json({ theme, updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update shared theme" },
      { status: 400 },
    );
  }
}
