import { NextResponse } from "next/server";
import { readDashboardConfig } from "../../../../lib/dashboard-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readDashboardConfig();
  return NextResponse.json({
    dashboard: {
      defaultZoneId: config.dashboard.defaultZoneId,
      aircon: config.dashboard.aircon,
      avatar: config.dashboard.avatar,
      bedroomHeater: config.dashboard.bedroomHeater,
      legacyPanelHeaterCardEnabled: config.dashboard.legacyPanelHeaterCardEnabled,
      lighting: config.dashboard.lighting,
      // Rotation rules only. The kiosk ADDRESSES stay server-side: they are how
      // a control mutation is recognised as coming from the panel, and handing
      // that list to every browser would publish the household's topology for
      // no gain.
      kiosk: { cameraRotations: config.dashboard.kiosk.cameraRotations },
      reminders: config.dashboard.reminders,
      specialZones: config.dashboard.specialZones,
      timing: config.dashboard.timing,
    },
    tasks: {
      alertAudio: config.tasks.alertAudio,
    },
    mapWeather: config.mapWeather,
    theme: config.theme,
  });
}
