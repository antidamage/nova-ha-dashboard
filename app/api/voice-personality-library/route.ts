import { NextResponse } from "next/server";
import { parseVoicePersonalityLibraryUpdateRequest } from "../../../lib/api/dashboard-requests";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";
import { normalizeVoicePersonalityLibrary } from "../../../lib/voice-personality-library";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({
      library: normalizeVoicePersonalityLibrary(preferences.voicePersonalityLibrary),
      updatedAt: preferences.voicePersonalityLibraryUpdatedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read voice personality library" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { library } = parseVoicePersonalityLibraryUpdateRequest(await request.json());
    const normalized = normalizeVoicePersonalityLibrary(library);
    const updatedAt = new Date().toISOString();
    await mergeDashboardPreferences({
      voicePersonalityLibrary: normalized,
      voicePersonalityLibraryUpdatedAt: updatedAt,
    });

    return NextResponse.json({ library: normalized, updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update voice personality library" },
      { status: 400 },
    );
  }
}
