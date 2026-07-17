import { NextResponse } from "next/server";
import { parseThemeLibraryUpdateRequest } from "../../../lib/api/dashboard-requests";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { normalizeThemeLibrary } from "../../../lib/theme-library";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({
      library: normalizeThemeLibrary(preferences.themeLibrary),
      updatedAt: preferences.themeLibraryUpdatedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read theme library" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { library } = parseThemeLibraryUpdateRequest(await request.json());
    const normalized = normalizeThemeLibrary(library);
    const updatedAt = new Date().toISOString();
    await mergeDashboardPreferences({ themeLibrary: normalized, themeLibraryUpdatedAt: updatedAt });

    return NextResponse.json({ library: normalized, updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update theme library" },
      { status: 400 },
    );
  }
}
