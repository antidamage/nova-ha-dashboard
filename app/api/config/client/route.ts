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
      specialZones: config.dashboard.specialZones,
      timing: config.dashboard.timing,
    },
    mapWeather: config.mapWeather,
    theme: config.theme,
  });
}
