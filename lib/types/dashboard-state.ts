import type { OrbInfoPreferences } from "../orb-info/types";
import type { AgentPreferences, DesignPreferences, LayoutPreferences, RouterStatus, SunStatus, UpdatePreferences, WatchfacePreferences, WeatherStatus } from "./status";
import type { AirconPreferences, BedroomHeaterPreferences, ClimateControlState, PanelHeaterPreferences } from "./climate";
import type { DashboardEntity, DashboardZone, HaDomain, HaHealth } from "./ha";
import type { DashboardLightingConfig, LightingPreferences, SpectrumCursor } from "./lighting";
import type { PhonoscopePreferences } from "./phonoscope";
import type { VoicePreferences } from "./voice";

export type DashboardPreferences = {
  agent?: AgentPreferences;
  aircon?: AirconPreferences;
  /** Shared behavior flag; intentionally independent of saved theme presets. */
  followVisualizerWhenActive?: boolean;
  lighting?: LightingPreferences;
  panelHeater?: PanelHeaterPreferences;
  bedroomHeater?: BedroomHeaterPreferences;
  /**
   * Remembered settings for climate instances beyond the first of each kind,
   * keyed by instance id. The first air conditioner and the first heater keep
   * using `aircon` and `bedroomHeater` above, so an existing installation needs
   * no migration and cannot lose its settings to one.
   * See lib/climate-preferences.ts.
   */
  climate?: Record<string, { aircon?: AirconPreferences; heater?: BedroomHeaterPreferences }>;
  /**
   * Household-preferred sweep of every temperature knob, inside each unit's
   * hard limits. Always written whole, so the top-level merge replacing it is
   * correct. Unset = hard limits. See specs/temperature-encoder.md.
   */
  climateTargetRange?: { min: number; max: number };
  theme?: Record<string, unknown>;
  themeUpdatedAt?: string;
  themeLibrary?: Record<string, unknown>;
  themeLibraryUpdatedAt?: string;
  /** Uploaded UX sound clips; built-ins are never stored (specs/ux-sounds.md). */
  soundLibrary?: Record<string, unknown>;
  watchface?: WatchfacePreferences;
  /** Which status orb info module is shown, and how each one is displayed. */
  orbInfo?: OrbInfoPreferences;
  voice?: VoicePreferences;
  /** Host-backed library of saved voice personalities ({version, activeId, entries}). */
  voicePersonalityLibrary?: Record<string, unknown>;
  voicePersonalityLibraryUpdatedAt?: string;
  update?: UpdatePreferences;
  layout?: LayoutPreferences;
  phonoscope?: PhonoscopePreferences;
  /**
   * Which presentation layer the dashboard renders. Shared, like the theme —
   * not per-device — so the house looks the same on every screen. Design and
   * colour theme are independent axes: see specs/design-modules.md.
   */
  design?: DesignPreferences;
  designUpdatedAt?: string;
};

export type DashboardState = {
  generatedAt: string;
  zones: DashboardZone[];
  entities: DashboardEntity[];
  /**
   * Optional capabilities this installation has configured (see
   * lib/modules/registry). Absent ids mean the capability is unconfigured, and
   * the client omits its zone entirely rather than showing an empty one.
   * Optional on the type so older cached payloads still parse.
   */
  activeModuleIds?: string[];
  totals: Record<HaDomain, number>;
  lighting: DashboardLightingConfig;
  /**
   * Last-resort environment sensors per zone, from config. Carried on state
   * like `lighting` so the client can apply them without a second config fetch.
   */
  zoneEnvironmentFallbacks?: Array<{
    zoneId: string;
    temperatureEntityIds: string[];
    humidityEntityIds: string[];
  }>;
  router: RouterStatus;
  spectrumCursors?: Record<string, SpectrumCursor>;
  sun: SunStatus | null;
  weather: WeatherStatus | null;
  preferences: DashboardPreferences;
  /** Server-owned thermostat and device-ownership state. */
  climateControl: ClimateControlState;
  warnings: string[];
  /** HA snapshot freshness. Absent/`ok` = trust the snapshot; `degraded` = holding
   *  last-known-good through a transient HA outage (show a reconnecting hint). */
  haHealth?: HaHealth;
};
