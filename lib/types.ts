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
  /**
   * The alert session key (see `alertSessionKey`) whose chime has already been
   * played. Shared state, not per-device: the sound is one household event, so
   * the first screen to play it marks the occurrence and every other screen --
   * and every subsequent page load, which is where this used to go wrong --
   * stays quiet. Cleared alongside `alertDismissedFor` whenever the occurrence
   * itself changes (roll-forward, completion, reschedule).
   */
  alertChimedFor?: string;
  /**
   * Keep chiming on a cadence until someone dismisses the alert. Off by
   * default: a reminder announces itself once and then lives in the icon bar.
   * Only opt a reminder in when missing it actually matters.
   */
  annoy?: boolean;
  repeat?: TaskRepeat;
  source: TaskSource;
  sourceId?: string;
  sourceCalendar?: string;
  occurrenceDate?: string;
  readOnly?: boolean;
  /**
   * The upstream item has a recurrence rule. Local tasks carry `repeat`
   * instead; mirrored ones cannot, because `repeat` is local-only (the
   * roll-forward in tasks.ts must not fight iCloud for control of the
   * schedule). The reminder icon bar needs to know a mirrored reminder is a
   * standing chore so it can auto-join the bar, and this is that flag.
   */
  recurs?: boolean;
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
  housePartyZones?: Record<
    string,
    {
      enabled?: boolean;
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

export type VoicePreferences = {
  /** User-facing display name of the voice agent (emoji/symbols allowed). */
  agentName?: string;
  /**
   * Optional plain-text pronunciation of the agent name, used by the voice
   * service for the spoken/ASR-facing identity. Empty means "use the display
   * name".
   */
  agentNamePronunciation?: string;
  /**
   * System-wide voice killswitch. When false, the voice runtime drops all
   * microphone audio and closes any open conversation, disabling voice for the
   * entire household until it is turned back on. Defaults to true.
   */
  systemVoiceEnabled?: boolean;
  /** Learn local voice templates and personalize turns for recognized household members. */
  speakerRecognitionEnabled?: boolean;
  /**
   * Per-satellite killswitch: satellite ids that are individually switched off.
   * The voice server drops their microphone frames while they are listed, so one
   * satellite can be silenced (e.g. while testing other devices) without stopping
   * its process. An explicit empty list enables every satellite; absent defaults
   * to Nocturnium disabled so only the primary Indium mic is processed.
   */
  disabledSatellites?: string[];
  /**
   * Run the lightweight activity/noise gate on native satellites before they
   * transmit audio. Disable temporarily to stream every frame for diagnostics.
   */
  satelliteNoiseGateEnabled?: boolean;
  speaker?: "Ryan" | "Aiden" | "Vivian" | "Serena" | "Uncle_Fu" | "Dylan" | "Eric" | "Ono_Anna" | "Sohee";
  /**
   * Custom-engine (dots.tts) voice: a cloned-voice id from the voice server's
   * registry. Separate from `speaker` because each TTS engine has its own
   * disjoint voice namespace; each engine keeps its own last-used voice.
   */
  customSpeaker?: string;
  /**
   * Trained-engine (GPT-SoVITS) voice: a fine-tuned checkpoint id from the
   * voice server's trained-voice registry. Own namespace for the same reason
   * as `customSpeaker`. May be empty until a voice has been trained.
   */
  trainedSpeaker?: string;
  language?: "Auto" | "English" | "Chinese" | "Japanese" | "Korean" | "German" | "French" | "Russian" | "Portuguese" | "Spanish" | "Italian";
  accent?: "voice-native" | "new-zealand" | "australian" | "british" | "american" | "irish" | "scottish";
  speechRate?: number;
  pitch?: number;
  emotion?: "natural" | "calm" | "cheerful" | "empathetic" | "serious" | "dry" | "energetic";
  emotionMirroring?: number;
  /** LLM sampling temperature for spoken-response rendering (0 = deterministic). */
  temperature?: number;
  /** Chance (0-1) that a conversational reply is rendered as two to four sentences. */
  longResponseProbability?: number;
  /**
   * Spoken-word length of a verified command acknowledgement is rolled per
   * reply as a random value in [commandReplyMinWords, commandReplyMaxWords]
   * (0-10 each). Zero at both ends means a silent acknowledgement; raising
   * the minimum guarantees an audible reply every time — useful during
   * development, when silent success is easy to mistake for no response.
   */
  commandReplyMinWords?: number;
  commandReplyMaxWords?: number;
  /**
   * Let the agent look things up online when a request needs current or external
   * information. Default off — this is the only feature that sends any text off
   * the local network (the rewritten query only), so it is opt-in.
   */
  webAccessEnabled?: boolean;
  /**
   * Which backend answers a web lookup. "brave" scrapes Brave Search in a
   * headless browser (Google-tier, keyless, non-Google); "local" is keyless
   * DuckDuckGo + on-device summarize; "gemini" is retained in code only.
   */
  webBackend?: "brave" | "local" | "gemini";
  /** How many sentences a spoken web answer may run (1-5). */
  webAnswerMaxSentences?: number;
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
  /**
   * Custom (dots.tts) diffusion step count — the model-side latency/quality
   * lever. Fewer steps reach first audio sooner and cost less GPU per reply.
   * Ignored by the Classic engine.
   */
  dotsNumSteps?: number;
  /**
   * Speaker-matching tuning — TitaNet cosine similarity thresholds (0-1) that
   * control how fuzzy voice recognition is across mics, rooms, and distances.
   * Defaults mirror the voice service's historical env values.
   */
  /** Min cosine to accept a turn as a known person. Lower = recognizes more readily. */
  speakerMatchThreshold?: number;
  /** Required lead of the best match over the runner-up before it is trusted. */
  speakerMatchMargin?: number;
  /** Min cosine to merge a capture into an existing unnamed profile vs. making a new one. */
  speakerClusterThreshold?: number;
  /** Min cosine to keep the same speaker across one open conversation's follow-up turns. */
  speakerConversationMatchThreshold?: number;
  /** Transcript header decoration template (%u%/%a%/%d%/%t%/%m% tokens). */
  transcriptTemplate?: string;
  /**
   * The agent's third-person pronouns in three forms (subjective/objective/
   * possessive), passed to the language model so it refers to itself correctly.
   * Part of a saved voice personality.
   */
  pronouns?: {
    subjective?: string;
    objective?: string;
    possessive?: string;
  };
  /**
   * Speech affectations: deterministic quirks the voice service applies to the
   * finished reply text (dashboard checkboxes). Part of a saved voice
   * personality.
   */
  affectations?: {
    /** Drop first- and second-person pronouns from spoken replies. */
    pronounDrop?: boolean;
  };
  updatedAt?: string;
};

export type DashboardPreferences = {
  agent?: AgentPreferences;
  aircon?: AirconPreferences;
  /** Shared behavior flag; intentionally independent of saved theme presets. */
  followVisualizerWhenActive?: boolean;
  lighting?: LightingPreferences;
  panelHeater?: PanelHeaterPreferences;
  theme?: Record<string, unknown>;
  themeUpdatedAt?: string;
  themeLibrary?: Record<string, unknown>;
  themeLibraryUpdatedAt?: string;
  watchface?: WatchfacePreferences;
  voice?: VoicePreferences;
  /** Host-backed library of saved voice personalities ({version, activeId, entries}). */
  voicePersonalityLibrary?: Record<string, unknown>;
  voicePersonalityLibraryUpdatedAt?: string;
  update?: UpdatePreferences;
  layout?: LayoutPreferences;
  phonoscope?: PhonoscopePreferences;
};

export type PhonoscopePreferences = {
  activeModuleId?: string;
  activeModuleVersion?: string;
  idleBehavior?: "ambient" | "black" | "return";
  message?: string;
  messageScaleSource?: PhonoscopeParameterSource;
  glowOverlay?: PhonoscopeGlowOverlay;
  statusOverlay?: boolean;
  transitionMs?: number;
  housePartyRandomHueOffset?: number;
  providers?: {
    spotify?: boolean;
    songle?: boolean;
    essentia?: boolean;
    reccoBeats?: boolean;
    lrclib?: boolean;
  };
  moduleSettings?: Record<string, Record<string, number>>;
  /** module id -> setting id -> live baseline parameter source */
  moduleParameterSources?: Record<string, Record<string, PhonoscopeParameterSource>>;
  pendingStructuralModuleSettings?: Record<string, Record<string, number>>;
  moduleReloadGenerations?: Record<string, number>;
  colorGroups?: PhonoscopeColorGroup[];
  moduleColorGroupIds?: Record<string, string>;
  /** Transient dashboard editor preview; cleared when the editor closes. */
  editorPreviewColorGroupId?: string;
  editorPreviewColorThemeId?: string;
  /**
   * Legacy dashboard-theme-backed groups. Read only for the v2 migration; new
   * writes use `colorGroups`.
   */
  themeGroups?: PhonoscopeThemeGroup[];
  moduleThemeGroupIds?: Record<string, string>;
  updatedAt?: string;
};

export type PhonoscopeColorValue = {
  rgb: [number, number, number];
  intensity: number;
  opacity: number;
  cursor?: { x: number; y: number };
};

/**
 * The final glow/bloom layer, laid over the whole visual stream — including the
 * centre message — as the last pass of a frame.
 *
 * Blur amount (0-20), opacity (0-100) and blend mode each carry their own
 * parameter driver, so all three are stored as sources rather than plain
 * values, exactly like `messageScaleSource`.
 *
 * The blend mode uses Photoshop's naming, on a whole-numbered axis: 0 is screen,
 * 1 is multiply, 2 is overlay, and both engines snap to the nearest rather than
 * cross-fading. That is what lets a beat driver swap the mode on the beat while
 * a manual source still behaves as the plain named choice it looks like.
 */
export type PhonoscopeGlowOverlay = {
  blendModeSource: PhonoscopeParameterSource;
  blurSource: PhonoscopeParameterSource;
  opacitySource: PhonoscopeParameterSource;
};

export type PhonoscopeParameterSource =
  | { type: "manual"; value: number }
  | {
      type: "random";
      min: number;
      max: number;
      cadence: "beat" | "downbeat" | "bar" | "song" | "interval";
      intervalSeconds: number;
      transitionSeconds: number;
    }
  | {
      type: "beat" | "downbeat" | "energy" | "bass" | "mid" | "treble";
      min: number;
      max: number;
      attackSeconds: number;
      holdSeconds: number;
      releaseSeconds: number;
    };

export type PhonoscopeColorTheme = {
  id: string;
  name: string;
  colors: Record<string, PhonoscopeColorValue>;
  /** module id -> setting id -> source */
  parameterOverrides: Record<string, Record<string, PhonoscopeParameterSource>>;
};

export type PhonoscopeColorGroup = {
  id: string;
  /** Colour groups are owned by one visualiser and never shared across modules. */
  moduleId: string;
  name: string;
  themes: PhonoscopeColorTheme[];
  order: "sequential" | "shuffle";
  changeMode: "interval" | "song" | "downbeat";
  waitSeconds: number;
  transitionSeconds: number;
  housePartyHueMode: "follow" | "complement";
  housePartyBrightnessMode: "follow" | "oppose" | "ignore";
};

export type PhonoscopeThemeGroupEntry = {
  themeId: string;
  baseVariant: "dark" | "light";
  swapOnDownbeat: boolean;
  genres: string[];
};

export type PhonoscopeThemeGroup = {
  id: string;
  name: string;
  themes: PhonoscopeThemeGroupEntry[];
  useGenres: boolean;
  order: "sequential" | "shuffle";
  changeMode: "interval" | "song" | "downbeat";
  waitSeconds: number;
  transitionSeconds: number;
  housePartyHueMode: "follow" | "complement";
  housePartyBrightnessMode: "follow" | "oppose" | "ignore";
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
