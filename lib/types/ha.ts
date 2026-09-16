export type HaDomain =
  | "light"
  | "switch"
  | "climate"
  | "fan"
  | "cover"
  | "humidifier"
  | "sensor";

export type HaState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
};

/**
 * Verdict on the freshness/trustworthiness of the current HA snapshot. `ok` is
 * the normal case. `degraded` means Home Assistant returned a mass-unavailable
 * snapshot (restart/reload) and the dashboard is holding last-known-good state;
 * the UI shows a subtle "reconnecting" indicator instead of flipping every tile
 * to unavailable. See lib/ha/health.ts.
 */
export type HaHealth = {
  status: "ok" | "degraded";
  degradedSince: string | null;
  heldEntityCount: number;
  reason?: "mass-unavailable" | "empty-snapshot" | "hold-expired";
};

export type AreaRegistryEntry = {
  id?: string;
  area_id?: string;
  name: string;
  aliases?: string[];
  icon?: string | null;
  floor_id?: string | null;
  labels?: string[];
  // HA-native area -> sensor bindings (Home Assistant 2024.x+). When set, these
  // are the trusted environment readings for the area and drive Nova's
  // environment panels without any per-home configuration.
  temperature_entity_id?: string | null;
  humidity_entity_id?: string | null;
};

export type DeviceRegistryEntry = {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  labels?: string[];
  // [platform, id] tuples, e.g. ["tuya_local", "<devId>"] or
  // ["mqtt", "tuya_mobile_<devId>"]. Used to pair LAN devices with their
  // cloud-bridge twins (lib/ha/twins.ts).
  identifiers?: Array<[string, string] | string[]>;
};

export type EntityRegistryEntry = {
  entity_id: string;
  area_id?: string | null;
  device_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  platform?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  entity_category?: string | null;
  labels?: string[];
};

export type LabelRegistryEntry = {
  label_id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
};

export type DashboardEntity = {
  entity_id: string;
  domain: HaDomain;
  state: string;
  name: string;
  area_id: string;
  device_id?: string | null;
  isIllumination?: boolean;
  // HA labels (resolved to their slugs/ids) carried through so modules can claim
  // entities by label without re-reading the registry.
  labels?: string[];
  attributes: Record<string, unknown>;
  // Set while the light is still moving toward a commanded brightness. Its
  // reported brightness is a point on the way there, not a result — clients must
  // show `targetPct` and wait for the field to clear rather than treating the
  // reading as final. See lib/lighting-convergence.
  brightnessTransition?: { targetPct: number };
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
};

export type DashboardZone = {
  id: string;
  name: string;
  entities: DashboardEntity[];
  counts: Record<HaDomain, number>;
  isOn: boolean;
  brightnessPct: number;
  // Present while any lit member of the zone is still moving toward a commanded
  // brightness, in which case `brightnessPct` is a mid-transition average and
  // `targetPct` is where the zone is going. Controls bind to the target and hold
  // it until this clears; the lights themselves still fade normally.
  brightnessTransition?: { targetPct: number };
  special?: "power" | "tasks" | "world" | "voice";
  // HA-native area sensor bindings for this zone's room, if set. Drives the
  // environment panel without any per-home configuration.
  environment?: {
    temperatureEntityId: string | null;
    humidityEntityId: string | null;
  };
};
