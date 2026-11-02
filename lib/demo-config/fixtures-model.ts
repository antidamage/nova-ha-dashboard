import type { DashboardConfig, SecretSetupStatus } from "../config-schema";
import demoDevices from "../../config/demo-devices.default.json";

/** Public fixture wiring, deliberately separate from the empty install defaults. */
export function demoDashboardConfig(config: DashboardConfig): DashboardConfig {
  const next = structuredClone(config);
  next.dashboard.aircon.matchTokens = demoDevices.aircon.matchTokens;
  next.dashboard.aircon.title = "Air Conditioner";
  next.dashboard.bedroomHeater.switchEntityIds = demoDevices.bedroomHeater.switchEntityIds;
  next.dashboard.bedroomHeater.temperatureEntityIds = demoDevices.bedroomHeater.temperatureEntityIds;
  next.dashboard.bedroomHeater.humidityEntityIds = demoDevices.bedroomHeater.humidityEntityIds;
  next.dashboard.bedroomHeater.title = "Bedroom Heater";
  // The public site shows the panels of a configured home. Other demo builds, the
  // e2e suite among them, keep the derivation a fresh install starts from.
  if (process.env.NEXT_PUBLIC_NOVA_DEMO_WALL_DISPLAY === "true") {
    next.dashboard.aircon.title = demoDevices.aircon.title;
    next.dashboard.bedroomHeater.title = demoDevices.bedroomHeater.title;
    next.dashboard.controls = demoDevices.controls as DashboardConfig["dashboard"]["controls"];
    next.dashboard.lighting = { ...next.dashboard.lighting, ...demoDevices.lighting } as DashboardConfig["dashboard"]["lighting"];
  }
  return next;
}

export function demoClientConfig(config: DashboardConfig) {
  return {
    dashboard: {
      defaultZoneId: config.dashboard.defaultZoneId,
      aircon: config.dashboard.aircon,
      avatar: config.dashboard.avatar,
      bedroomHeater: config.dashboard.bedroomHeater,
      legacyPanelHeaterCardEnabled: config.dashboard.legacyPanelHeaterCardEnabled,
      lighting: config.dashboard.lighting,
      specialZones: config.dashboard.specialZones,
      timing: config.dashboard.timing,
    },
    mapWeather: config.mapWeather,
    theme: config.theme,
  };
}

export function demoSecretSetupStatus(config: DashboardConfig): SecretSetupStatus {
  return {
    homeAssistant: {
      urlConfigured: false,
      tokenConfigured: false,
    },
    iCloud: {
      usernameConfigured: false,
      appPasswordConfigured: false,
      enabled: false,
    },
    powershop: {
      emailConfigured: false,
      passwordConfigured: false,
      enabled: false,
    },
    mcp: {
      bearerTokenConfigured: false,
      authRequired: config.mcp.requireBearerAuth,
    },
  };
}
