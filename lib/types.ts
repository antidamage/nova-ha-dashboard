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

export type AreaRegistryEntry = {
  id?: string;
  area_id?: string;
  name: string;
  aliases?: string[];
};

export type DeviceRegistryEntry = {
  id: string;
  area_id?: string | null;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
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
};

export type DashboardEntity = {
  entity_id: string;
  domain: HaDomain;
  state: string;
  name: string;
  area_id: string;
  device_id?: string | null;
  isIllumination?: boolean;
  attributes: Record<string, unknown>;
};

export type DashboardZone = {
  id: string;
  name: string;
  entities: DashboardEntity[];
  counts: Record<HaDomain, number>;
  isOn: boolean;
  brightnessPct: number;
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

export type DashboardPreferences = {
  aircon?: AirconPreferences;
  lighting?: LightingPreferences;
  theme?: Record<string, unknown>;
  themeUpdatedAt?: string;
};

export type DashboardState = {
  generatedAt: string;
  zones: DashboardZone[];
  entities: DashboardEntity[];
  totals: Record<HaDomain, number>;
  router: RouterStatus;
  spectrumCursors?: Record<string, SpectrumCursor>;
  sun: SunStatus | null;
  weather: WeatherStatus | null;
  preferences: DashboardPreferences;
  warnings: string[];
};
