import type { AppleTvSwipeSettings } from "../appletv-swipe";

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
  /** The daily forecast, today first. Shown under the weather panel's fold. */
  forecast?: WeatherForecastDay[];
};

export type WeatherForecastDay = {
  datetime: string | null;
  condition: string | null;
  high: number | null;
  low: number | null;
  rainChancePct: number | null;
  precipitation: number | null;
};

export type SunStatus = {
  entity_id: string;
  state: string;
  nextRising: string | null;
  nextSetting: string | null;
};

export type WatchfacePreferences = {
  daysSinceGym?: number;
  gymAlertThresholdHours?: number;
  gymLastResetAt?: string;
  idleTimeoutMs?: number;
  updatedAt?: string;
};

export type AgentPreferences = {
  /** Enable bounded post-action state polling (the Ralph Wiggum loop). */
  ralphLoopEnabled?: boolean;
  /** Maximum authoritative state refreshes after the immediate response. */
  ralphLoopMaxIterations?: number;
  /** Pause between state refreshes. */
  ralphLoopSleepMs?: number;
  /** Wall-clock deadline after which an unverified action is reported as failed. */
  ralphLoopFailureSeconds?: number;
  /**
   * A loop still polling past this many milliseconds prints a single
   * "*Thinking*" marker to the voice transcript (non-verbal, never spoken) so
   * anyone watching the dashboard knows a slow device is still being
   * confirmed rather than assuming the turn stalled.
   */
  ralphLoopThinkingThresholdMs?: number;
  /**
   * Let a small JSON-only LLM pass judge whether the observed device state
   * satisfies the turn's objective once the cheap deterministic check has not
   * yet succeeded. Its verdict is authoritative for ending the loop early or
   * explaining a partial failure. Disabling it falls back to the original
   * purely deterministic polling behaviour.
   */
  ralphLoopLlmVerifyEnabled?: boolean;
  /**
   * Minimum spacing between LLM confirmation calls within one turn's loop, no
   * matter how many devices are pending, so a slow multi-item confirmation
   * cannot flood the local LLM with a call per poll.
   */
  ralphLoopLlmVerifyMinIntervalMs?: number;
  /**
   * Hard cutoff for a single LLM confirmation call, in seconds. A slow or
   * hanging LLM backend can never make the loop run past the failure deadline
   * by more than this fixed budget.
   */
  ralphLoopLlmConfirmTimeoutSeconds?: number;
  updatedAt?: string;
};

export type DesignPreferences = {
  activeId?: string;
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
  /**
   * Whether the update banner is allowed to appear on the dashboard home page.
   * Off unless explicitly turned on; the config page's banner is unaffected.
   */
  showUpdatesOnHome?: boolean;
  updatedAt?: string;
};
