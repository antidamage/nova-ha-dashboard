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
      lighting: config.dashboard.lighting,
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
