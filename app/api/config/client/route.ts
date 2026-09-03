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
    // Where sign-in actually works, when it is not this address.
    //
    // The LAN vhosts are HTTPS too, so "use the HTTPS address" was useless
    // advice to somebody already on HTTPS. They answer config_gate_denied -- a
    // flat 403 with no login path -- so a session obtained there would not open
    // /config anyway. Naming the address that does work, as a link, is the only
    // actionable thing to say.
    signInBaseUrl: (process.env.NOVA_SIGNIN_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    mapWeather: config.mapWeather,
    theme: config.theme,
  });
}
