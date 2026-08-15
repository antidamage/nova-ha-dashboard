import type { AppleTvSwipeSettings } from "./appletv-swipe";
import type { LightEntityPreset } from "./lighting-presets";
import type { OrbInfoPreferences } from "./orb-info/types";

export type { OrbInfoPreferences };

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

/**
 * A reminder whose schedule is derived from another reminder's completion
 * rather than from a clock interval.
 *
 * The follow-on has no cadence of its own: completing the anchor is what puts
 * it back on the board, `offsetDays` clear days later at `hour` local time. Its
 * effective cycle is therefore whatever the anchor's turns out to be, which is
 * the point — a chore that only makes sense "the evening after the injection"
 * has to move when the injection moves.
 */
export type TaskFollows = {
  /** The anchor reminder's id. */
  taskId: string;
  /** Whole days after the anchor's completion. 0 is the same day. */
  offsetDays: number;
  /** Local hour of day the follow-on lands on. */
  hour: number;
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
  /**
   * Scheduled from another reminder's completion. Mutually exclusive with
   * `repeat` — a follow-on borrows the anchor's cadence, so giving it a second,
   * independent one would just make the two fight over `start`.
   */
  follows?: TaskFollows;
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
  /*
   * Auto's cycle bookkeeping (see AirconAutoState in lib/aircon-control.ts).
   *
   * It lives in preferences because the thermostat loop runs per browser tab: a
   * 30-minute direction hold kept only in a ref would reset on every kiosk
   * reload, and two open dashboards would each keep their own idea of when the
   * compressor last transitioned. It rides along on the `remember` payloads the
   * loop already writes with every transition, so it adds no preference writes.
   */
  autoLastMode?: "heat" | "cool" | null;
  autoLastModeAt?: number | null;
  autoLastTransitionAt?: number | null;
  /** Trailing-hour start telemetry retained for diagnostics; never a limit. */
  autoRecentStartsAt?: number[];
  /** Reading at the start of the current post-stop sensor transient. */
  autoSettlingFromTemperature?: number | null;
  /** See AirconAutoState.sensorPendingSinceAt in lib/aircon-control.ts. */
  autoSensorPendingSinceAt?: number | null;
  updatedAt?: string;
};

export type PanelHeaterPreferences = {
  offTimerEndsAt?: string | null;
  updatedAt?: string;
};

/**
 * The bedroom heater is a plain on/off switch with onboard climate sensors and
 * no setpoint of its own, so the thermostat lives in Nova (see
 * lib/bedroom-heater-control.ts).
 *
 * The auto window is stored as minutes from midday rather than a wall-clock
 * time so the slider's domain (0..1440) is the stored value, and the
 * midday-to-midday wrap needs no date arithmetic anywhere. 0 = midday today,
 * 720 = midnight, 1440 = midday tomorrow.
 */
export type BedroomHeaterMode = "auto" | "off";

export type BedroomHeaterPreferences = {
  /** "manual" is retired and read as "auto"; see bedroomHeaterMode(). */
  mode?: BedroomHeaterMode | "manual";
  temperature?: number;
  autoOnMinutes?: number;
  autoOffMinutes?: number;
  /**
   * Sleep timer. When this passes the server loop switches the heater off and
   * drops the mode to "off". It lives server-side, like the thermostat loop, so
   * it still fires with every dashboard client asleep.
   */
  offTimerEndsAt?: string | null;
  updatedAt?: string;
};

export type ClimateControlOwner = "nova" | "external";
export type ClimateControlMode = "auto" | "manual" | "off";
export type ClimateControlPhase = "driving" | "grace" | "resting" | "off" | "fault";

export type ClimateControlRoomState = {
  owner: ClimateControlOwner;
  mode: ClimateControlMode;
  phase: ClimateControlPhase;
  direction: "heat" | "cool" | "fan_only" | null;
  sensorAvailable: boolean;
  sensorReportedAt: string | null;
  sensorGraceEndsAt: string | null;
  actuatorAvailable: boolean;
  overrideReason: string | null;
  lastStopReason: string | null;
};

export type ClimateControlState = {
  lounge: ClimateControlRoomState;
  bedroom: ClimateControlRoomState;
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
   * Voice training. On, an unrecognized voice may still wake the assistant and
   * issue commands, and every accepted turn refines recognition — the mode for
   * enrolling someone, adding a microphone or room, or a day when a familiar
   * voice sounds different. Off, only recognized household voices are heard.
   * Bypassed entirely when speaker recognition is unavailable.
   */
  voiceTrainingEnabled?: boolean;
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
  /**
   * Absolute seconds a conversation may live from the wake word that opened it.
   * The idle window is refreshed by every engaged turn and so cannot bound a
   * conversation on its own; this is the backstop that always closes it.
   */
  conversationMaxSeconds?: number;
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
  bedroomHeater?: BedroomHeaterPreferences;
  theme?: Record<string, unknown>;
  themeUpdatedAt?: string;
  themeLibrary?: Record<string, unknown>;
  themeLibraryUpdatedAt?: string;
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
};

export type PhonoscopePreferences = {
  /**
   * Which migrations the stored shape has already been through. Absent on
   * anything written before the percentage-geometry conversion, which is
   * exactly how `readPhonoscopeConfig` knows to apply it. See
   * `lib/phonoscope-migrate-v4.ts`.
   */
  schemaVersion?: number;
  activeModuleId?: string;
  activeModuleVersion?: string;
  idleBehavior?: "ambient" | "black" | "return";
  /**
   * Seconds of silence before the picture fades to black and a randomly chosen
   * centre image bounces around the frame. 0 (or absent) disables it.
   *
   * Global rather than per-module: it is what the screen does when there is no
   * music at all, so it cannot belong to whichever visualiser was going to draw
   * that music. It sits beside `idleBehavior` because it is the same subject —
   * what happens when nothing is playing — and it reuses that setting's fade to
   * black rather than introducing a second one.
   */
  screensaverSeconds?: number;
  message?: string;
  statusOverlay?: boolean;
  transitionMs?: number;
  providers?: {
    spotify?: boolean;
    songle?: boolean;
    essentia?: boolean;
    reccoBeats?: boolean;
    lrclib?: boolean;
  };
  moduleSettings?: Record<string, Record<string, number>>;
  pendingStructuralModuleSettings?: Record<string, Record<string, number>>;
  moduleReloadGenerations?: Record<string, number>;
  /** Named sets of driver lanes. Colour group entries name the ones they ride with. */
  settingsGroups?: PhonoscopeSettingsGroup[];
  /** Flat library of colour-only themes, referenced by colour group entries. */
  colorThemes?: PhonoscopeColorTheme[];
  /** The rotation playlists. */
  colorGroups?: PhonoscopeColorGroup[];
  moduleColorGroupIds?: Record<string, string>;
  /** Route the colour group by the playing track's genre rather than the manual pick. */
  chooseColorGroupByGenre?: boolean;
  /** Undriveable parameters that apply across every settings group. */
  structuralSettings?: Record<string, number>;
  houseParty?: PhonoscopeHouseParty;
  /**
   * Solo locks the visualiser to one colour theme and/or one settings group,
   * overriding the rotation until it is switched off. Unlike the editor preview
   * it is persisted and deliberately survives leaving the page — it is a
   * "hold it here while I work on it" switch, not a transient pin.
   */
  soloColorThemeId?: string;
  soloSettingsGroupId?: string;
  /** Transient dashboard editor preview; cleared when the editor closes. */
  editorPreviewColorGroupId?: string;
  editorPreviewColorEntryId?: string;
  updatedAt?: string;
};

/**
 * One signal a driver lane runs on.
 *
 * `beat`, `downbeat`, `timer` and `song` are pulses; `energy`, `bass`, `mid`
 * and `treble` are continuous levels; `random` is a pulse too — it fires once
 * per `cadence` window, at a random point inside it. The shape is deliberately
 * flat and total rather than a discriminated union, because `config_client.cpp`
 * and `PhonoscopeModels.swift` hand-parse the same JSON and a union costs them a
 * branch per field.
 */
export type PhonoscopeDriverType =
  | "beat"
  | "downbeat"
  | "timer"
  | "song"
  | "energy"
  | "bass"
  | "mid"
  | "treble"
  | "random";

/** The driver types that fire discrete events rather than carrying a level. */
export type PhonoscopePulseType = "beat" | "downbeat" | "timer" | "song";

export type PhonoscopeDriver = {
  type: PhonoscopeDriverType;
  /**
   * Pulse drivers fire on every Nth event, 1-16 — "every 4th downbeat". Level
   * drivers ignore it.
   */
  every: number;
  /** Which event within the `every` cycle, `0..every-1`. */
  offset: number;
  /**
   * Subdivisions per pulse, 1/2/4/8 — the other direction from `every`. A beat
   * driver with `divide: 4` fires four times a beat, a downbeat driver four
   * times a bar. Only `beat` and `downbeat` (and a `random` whose cadence is
   * one of them) subdivide; a subdivided driver always has `every: 1` and
   * `offset: 0`, because which of eight sub-beats a run starts on is not
   * something anyone can hear.
   */
  divide: number;
  /** Seconds between pulses when this driver, or a random driver's cadence, is `timer`. */
  intervalSeconds: number;
  /**
   * `random` only: the pulse whose interval is the window it fires somewhere
   * inside. `every` and `divide` size that window rather than selecting which
   * pulses count, so "every 4th downbeat" is one fire per four bars at a moving
   * moment, not a jittered hit inside the fourth bar.
   */
  cadence: PhonoscopePulseType;
};

/**
 * One appearance of an effect inside a lane. Sparse on purpose: an absent field
 * inherits the effect's declared default, so a binding stores only what the user
 * actually chose to change.
 */
export type PhonoscopeEffectBinding = {
  id: string;
  /** A module setting id, or a private picture effect such as `__glowBlur`. */
  effect: string;
  min?: number;
  max?: number;
  attackSeconds?: number;
  holdSeconds?: number;
  releaseSeconds?: number;
  /**
   * Draw the target at random from inside `[min, max]` on each lane event
   * instead of always driving to `max`. The envelope is untouched: it still
   * shapes the approach, so the ramp reads as the transition curve from the
   * bottom of the range up to whatever was drawn this time.
   *
   * Orthogonal to the `random` driver — that randomises *when* the lane fires,
   * this randomises *how far* it goes — so the two stack in any combination.
   */
  randomValue?: boolean;
  /** Effect-specific scalars, such as `order` on `__themeChange`. */
  params?: Record<string, number>;
};

export type PhonoscopeDriverLane = {
  id: string;
  driver: PhonoscopeDriver;
  /** Summed onto the main driver's signal; rendered inset beneath it. */
  modifiers: PhonoscopeDriver[];
  bindings: PhonoscopeEffectBinding[];
};

/**
 * How an effect resolves when more than one lane drives it at once.
 *
 * - `add` sums every lane's contribution above its resting value.
 * - `strongest` takes the contribution from the LEAST FREQUENT firing lane
 *   outright, so an every-4th-downbeat hit covers the plain downbeat rather
 *   than compounding with it.
 * - `common` is its mirror: the MOST FREQUENT firing lane takes it, so the
 *   busiest lane sets the value and the rare punctuation stays out of the way.
 * - `override` is a replacement rather than a contribution — the last lane in
 *   merge order takes the effect outright, carrying its own resting value with
 *   it. This is how an override settings group's value always beats the
 *   default group's when both are present.
 *
 * The two original ids are kept verbatim: they are already stored in saved
 * configurations and hand-parsed by `config_client.cpp` and
 * `PhonoscopeModels.swift`. The UI labels them Sum / Least frequent lane wins /
 * Most frequent lane wins / Override.
 */
export type PhonoscopeCombineMode = "add" | "strongest" | "common" | "override";

export type PhonoscopeSettingsGroup = {
  id: string;
  name: string;
  /** Bindings name module setting ids, so a group belongs to one visualiser. */
  moduleId: string;
  lanes: PhonoscopeDriverLane[];
  /** effect id -> how its lanes stack. Shared by every appearance of that effect. */
  combine: Record<string, PhonoscopeCombineMode>;
  /** Parameters that cannot be driven at all; currently just `complexity`. */
  staticSettings: Record<string, number>;
  /** Exactly one group carries this. It cannot be deleted, and it catches every gap. */
  isDefault: boolean;
};

export type PhonoscopeHouseParty = {
  enabled: boolean;
  hueMode: "follow" | "complement";
  brightnessMode: "follow" | "oppose" | "ignore";
};

export type PhonoscopeColorValue = {
  rgb: [number, number, number];
  intensity: number;
  opacity: number;
  cursor?: { x: number; y: number };
};

/**
 * Colour, and the picture's centrepiece. Behaviour lives in settings groups,
 * which a colour group entry names alongside the theme, so the same palette can
 * run under several different sets of drivers.
 */
export type PhonoscopeColorTheme = {
  id: string;
  name: string;
  /** Palette slots are declared per module, so a theme belongs to one visualiser. */
  moduleId: string;
  colors: Record<string, PhonoscopeColorValue>;
  /**
   * A centre-image library id this theme puts in the middle of the frame, or
   * null for none. The rotation cross-fades between entries' images over the
   * same transition their palettes chase across.
   */
  imageId: string | null;
  /**
   * A library id this theme puts BEHIND the whole picture, or null for none.
   *
   * When set it replaces the procedural backdrop field entirely; when null the
   * field runs as it always has. Either way the same `__bg*` effects size it,
   * so the controls do not change when the content does. It is drawn inside the
   * backdrop pass, which puts it under the vignette — the frame closes over the
   * image exactly as it closes over the field.
   */
  backgroundImageId: string | null;
};

/**
 * One stop on a colour group's rotation. A theme may appear in several entries
 * with different settings groups — "theme 1 with settings A", then "theme 1 with
 * settings B", then "theme 2 with settings B" — which is why entries carry their
 * own id rather than being keyed by `themeId`.
 */
export type PhonoscopeColorGroupEntry = {
  id: string;
  themeId: string;
  /**
   * A second colour theme this entry blends to while the household's alt state
   * is on. It is a link into the same flat library rather than a theme of its
   * own, so editing that theme edits both places it is used.
   *
   * Null or absent means this entry has no alternative and simply keeps showing
   * `themeId` — the alt state stays on, it just has nothing to do here.
   */
  altThemeId?: string | null;
  /**
   * Applied in order. Their lanes all run at once; a colliding `combine` mode or
   * static setting layers, with the last group in this list winning.
   */
  settingsGroupIds: string[];
};

export type PhonoscopeColorGroup = {
  id: string;
  /** Colour groups are owned by one visualiser and never shared across modules. */
  moduleId: string;
  name: string;
  /** The rotation playlist, in order. */
  entries: PhonoscopeColorGroupEntry[];
  /** Exclusive across groups: assigning a genre here takes it from whoever held it. */
  genres: string[];
  /** Exactly one group carries this; it catches tracks with no or an unclaimed genre. */
  isDefault: boolean;
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
