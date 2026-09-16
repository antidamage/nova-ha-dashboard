// lib/types is the back-compat facade for the shared dashboard type surface.
// The definitions live in lib/types/, split by domain; this file just
// re-exports them so existing imports keep working. See
// specs/agent-token-footprint.md section 3.3.
export type { OrbInfoPreferences } from "./orb-info/types";

export type {
  AreaRegistryEntry,
  DashboardEntity,
  DashboardZone,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HaDomain,
  HaHealth,
  HaState,
  LabelRegistryEntry,
} from "./types/ha";

export type {
  DashboardLightingConfig,
  LightingIntensityThreshold,
  LightingPreferences,
  SpectrumCursor,
  ZoneLightEvent,
  ZoneLightEventTime,
} from "./types/lighting";

export type { Task, TaskFollows, TaskRepeat, TaskSource } from "./types/tasks";

export type {
  AirconPreferences,
  BedroomHeaterMode,
  BedroomHeaterPreferences,
  ClimateControlMode,
  ClimateControlOwner,
  ClimateControlPhase,
  ClimateControlRoomState,
  ClimateControlState,
  PanelHeaterPreferences,
} from "./types/climate";

export type {
  AgentPreferences,
  DesignPreferences,
  LayoutPreferences,
  RouterMetric,
  RouterStatus,
  SunStatus,
  UpdatePreferences,
  WatchfacePreferences,
  WeatherForecastDay,
  WeatherStatus,
} from "./types/status";

export type { VoicePreferences } from "./types/voice";

export type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeDriverType,
  PhonoscopeEffectBinding,
  PhonoscopeHouseParty,
  PhonoscopePreferences,
  PhonoscopePulseType,
  PhonoscopeSettingsGroup,
} from "./types/phonoscope";

export type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeColorValue,
} from "./types/phonoscope-color";

export type { DashboardPreferences, DashboardState } from "./types/dashboard-state";
