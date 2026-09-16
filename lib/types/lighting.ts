import type { LightEntityPreset } from "../lighting-presets";
import type { ZoneLightRule } from "../zone-light-rules";

export type LightingIntensityThreshold = {
  name?: string;
  thresholdPct: number;
  entityIds: string[];
};

export type ZoneLightEventTime =
  | { kind: "clock"; hhmm: string }
  | { kind: "sun"; event: "sunrise" | "sunset"; offsetMinutes: number };

/** One timed light event for a zone. See specs/zone-light-events.md. */
export type ZoneLightEvent = {
  id: string;
  zoneId: string;
  name?: string;
  enabled: boolean;
  at: ZoneLightEventTime;
  /** Weekdays it may fire on, 0 = Sunday. Empty means every day. */
  days: number[];
  value: { hue: number; saturation: number; brightnessPct: number };
};

export type DashboardLightingConfig = {
  intensityThresholds: LightingIntensityThreshold[];
  // Per-entity overrides for lights that should ignore the zone's brightness/
  // colour and always use a fixed preset (see LightEntityPreset.pinned).
  entityPresets?: LightEntityPreset[];
  // Timed events the host fires for a zone (specs/zone-light-events.md).
  zoneEvents?: ZoneLightEvent[];
  // Lights an event may switch on; everything else has the value staged for
  // its next switch-on instead.
  eventSwitchOnEntityIds?: string[];
  // Every lighting automation for a zone, as rules (specs/zone-light-events.md,
  // round 2). The keys above are what they project into.
  zoneRules?: ZoneLightRule[];
  // Zones already given their Adaptive and White preset rules.
  zoneRulesSeededZoneIds?: string[];
};

export type SpectrumCursor = {
  x: number;
  y: number;
};

export type LightingPreferences = {
  adaptiveCandlelightZones?: Record<
    string,
    {
      enabled?: boolean;
      lastSunState?: "above_horizon" | "below_horizon";
      updatedAt?: string;
    }
  >;
  housePartyZones?: Record<
    string,
    {
      enabled?: boolean;
      updatedAt?: string;
    }
  >;
  updatedAt?: string;
};
