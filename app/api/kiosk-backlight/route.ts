import { NextResponse } from "next/server";
import { normalizeKioskBacklightSettings } from "../../../lib/kiosk-backlight/settings";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";

export const dynamic = "force-dynamic";

/** The kiosk backlight's day and night settings (specs/kiosk-backlight.md). */
export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json(
      { settings: normalizeKioskBacklightSettings(preferences.kioskBacklight) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to read the kiosk backlight" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const settings = normalizeKioskBacklightSettings(await request.json());
    // Written whole every time, so the top-level merge replacing it is correct.
    await mergeDashboardPreferences({ kioskBacklight: settings });
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save the kiosk backlight" }, { status: 400 });
  }
}
