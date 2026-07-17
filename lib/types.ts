import type { AppleTvSwipeSettings } from "./appletv-swipe";
import type { LightEntityPreset } from "./lighting-presets";

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
};

export type DashboardZone = {
  id: string;
  name: string;
  entities: DashboardEntity[];
  counts: Record<HaDomain, number>;
  isOn: boolean;
  brightnessPct: number;
  special?: "power" | "tasks" | "world";
  // HA-native area sensor bindings for this zone's room, if set. Drives the
  // environment panel without any per-home configuration.
  environment?: {
    temperatureEntityId: string | null;
    humidityEntityId: string | null;
  };
};

export type LightingIntensityThreshold = {
  name?: string;
  thresholdPct: number;
  entityIds: string[];
};

export type DashboardLightingConfig = {
  intensityThresholds: LightingIntensityThreshold[];
  // Per-entity overrides for lights that should ignore the zone's brightness/
  // colour and always use a fixed preset (see LightEntityPreset.pinned).
  entityPresets?: LightEntityPreset[];
};

export type SpectrumCursor = {
  x: number;
  y: number;
};

export type TaskSource = "local" | "icloud-calendar" | "icloud-reminders";

export type TaskRepeat =
  | {
      kind: "hourly";
    }
  | {
      kind: "morning-night";
    }
  | {
      kind: "days";
      intervalDays: number;
    };

export type Task = {
  id: string;
  name: string;
  start: string;
  end?: string;
  createdAt: string;
  dismissedAt?: string;
  alertDismissedAt?: string;
  alertDismissedFor?: string;
  repeat?: TaskRepeat;
  source: TaskSource;
  sourceId?: string;
  sourceCalendar?: string;
  occurrenceDate?: string;
  readOnly?: boolean;
};

export type RouterMetric = {
  entity_id: string;
  value: number | null;
  unit: string;
  display: string;
};

export type RouterStatus = {
  name: string;
  download: RouterMetric;
  upload: RouterMetric;
  externalIp: string;
  wanConnected: boolean | null;
  wanState: string;
};

export type WeatherStatus = {
  entity_id: string;
  condition: string;
  temperature: number | null;
  high: number | null;
  low: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windUnit: string;
  precipitation: number | null;
  precipitationUnit: string;
  rainChancePct: number | null;
  uvIndex: number | null;
  maxUvIndex: number | null;
  feelsLike: number | null;
};

export type SunStatus = {
  entity_id: string;
  state: string;
  nextRising: string | null;
  nextSetting: string | null;
};

export type AirconPreferences = {
  autoMode?: boolean;
  hvacMode?: string;
  temperature?: number;
  fanMode?: string;
  swingMode?: "off" | "both";
  quietMode?: boolean;
  turboMode?: boolean;
  offTimerEndsAt?: string | null;
  updatedAt?: string;
};

export type PanelHeaterPreferences = {
  offTimerEndsAt?: string | null;
  updatedAt?: string;
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
  updatedAt?: string;
};

export type WatchfacePreferences = {
  daysSinceGym?: number;
  gymAlertThresholdHours?: number;
  gymLastResetAt?: string;
  idleTimeoutMs?: number;
  updatedAt?: string;
};

export type VoicePreferences = {
  /** User-facing name of the voice agent. */
  agentName?: string;
  speaker?: "Ryan" | "Aiden" | "Vivian" | "Serena" | "Uncle_Fu" | "Dylan" | "Eric" | "Ono_Anna" | "Sohee";
  language?: "Auto" | "English" | "Chinese" | "Japanese" | "Korean" | "German" | "French" | "Russian" | "Portuguese" | "Spanish" | "Italian";
  accent?: "voice-native" | "new-zealand" | "australian" | "british" | "american" | "irish" | "scottish";
  speechRate?: number;
  pitch?: number;
  emotion?: "natural" | "calm" | "cheerful" | "empathetic" | "serious" | "dry" | "energetic";
  emotionMirroring?: number;
  /** LLM sampling temperature for spoken-response rendering (0 = deterministic). */
  temperature?: number;
  /** Spoken wake words and common speech-recognition variants. */
  wakeWords?: string[];
  /** Legacy single wake word; migrated into wakeWords when read. */
  wakeWord?: string;
  /** Space-separated greeting prefixes accepted before the wake word. */
  wakePrefixes?: string;
  /** Response playback volume percent during the day (8:00–21:00). */
  volumeDay?: number;
  /** Response playback volume percent at night (21:00–8:00). */
  volumeNight?: number;
  /** Personality description appended to the voice agent's LLM system prompt. */
  personality?: string;
  /** Seconds a conversation stays open without a turn before the wake word is required again. */
  conversationIdleSeconds?: number;
  /** Milliseconds of streamed audio the satellite buffers before starting playback. */
  ttsPrerollMs?: number;
  /** Milliseconds of audio per steady-state frame sent to satellites. */
  ttsFrameMs?: number;
  updatedAt?: string;
};

export type DashboardPreferences = {
  aircon?: AirconPreferences;
  lighting?: LightingPreferences;
  panelHeater?: PanelHeaterPreferences;
  theme?: Record<string, unknown>;
  themeUpdatedAt?: string;
  themeLibrary?: Record<string, unknown>;
  themeLibraryUpdatedAt?: string;
  watchface?: WatchfacePreferences;
  voice?: VoicePreferences;
  update?: UpdatePreferences;
  layout?: LayoutPreferences;
};

export type LayoutPreferences = {
  /**
   * Fraction (0..1) of the Apple TV screen height the horizontal control band
   * fills. Surfaced on the /api/theme envelope and polled live by the tvOS app.
   */
  tvHeightFraction?: number;
  /**
   * Apple TV swipe/stickiness tuning, surfaced on the same /api/theme envelope
   * and polled live by the tvOS app. See lib/appletv-swipe.ts for shape, defaults
   * and ranges.
   */
  swipe?: AppleTvSwipeSettings;
};

export type UpdatePreferences = {
  /** Live override for the auto-update switch; falls back to config.update.autoUpdate. */
  autoUpdate?: boolean;
  updatedAt?: string;
};

export type DashboardState = {
  generatedAt: string;
  zones: DashboardZone[];
  entities: DashboardEntity[];
  totals: Record<HaDomain, number>;
  lighting: DashboardLightingConfig;
  router: RouterStatus;
  spectrumCursors?: Record<string, SpectrumCursor>;
  sun: SunStatus | null;
  weather: WeatherStatus | null;
  preferences: DashboardPreferences;
  warnings: string[];
  /** HA snapshot freshness. Absent/`ok` = trust the snapshot; `degraded` = holding
   *  last-known-good through a transient HA outage (show a reconnecting hint). */
  haHealth?: HaHealth;
};
