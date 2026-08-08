import { z } from "zod";
import {
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX,
  AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN,
} from "./aircon-config";
import {
  DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
  DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT,
} from "./lighting-presets";

export const DASHBOARD_CONFIG_SCHEMA_VERSION = 1;

const entityIdSchema = z.string().min(1);
const stringListSchema = z.array(z.string().min(1)).default([]);
const millisecondsSchema = z.number().int().nonnegative();
const dayOfMonthSchema = z.number().int().min(1).max(31);
const urlTemplateSchema = z.string().min(1);
const lightBrightnessPctSchema = z.number().int().min(1).max(100);
const colorTemperatureKelvinSchema = z.number().int().min(1000).max(10000);

export const HaDomainSchema = z.enum(["light", "switch", "climate", "fan", "cover", "humidifier", "sensor"]);

const LightingIntensityThresholdSchema = z.object({
  name: z.string().min(1).optional(),
  thresholdPct: z.number().int().min(0).max(100),
  entityIds: z.array(entityIdSchema).min(1),
});
const LightColorTemperatureOverrideSchema = z.object({
  candlelight: colorTemperatureKelvinSchema.optional(),
  daylight: colorTemperatureKelvinSchema.optional(),
  sunlight: colorTemperatureKelvinSchema.optional(),
});
const LightingEntityPresetSchema = z.object({
  entityId: entityIdSchema,
  // Force this entity to always use the preset below, ignoring zone brightness/
  // colour commands. Reapplied on every zone edit and by the scheduled poller.
  pinned: z.boolean().optional(),
  targetBrightnessPct: z.object({
    daytime: lightBrightnessPctSchema.default(DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT),
    evening: lightBrightnessPctSchema.default(DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT),
  }).default({
    daytime: DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
    evening: DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT,
  }),
  colorTemperatureOverrideKelvin: LightColorTemperatureOverrideSchema.optional(),
});
const ThemeColorValueSchema = z.object({
  cursor: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  intensity: z.number().int().min(0).max(100),
  rgb: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]),
});
const NovaAvatarConfigSchema = z.object({
  gradientAlert: ThemeColorValueSchema,
  gradientCenter: ThemeColorValueSchema,
  gradientOuter: ThemeColorValueSchema,
  gymAlertThresholdHours: z.number().int().min(1).max(168),
  gymNumberColor: ThemeColorValueSchema,
  gymNumberOpacity: z.number().int().min(0).max(100),
  lineColors: z.tuple([ThemeColorValueSchema, ThemeColorValueSchema, ThemeColorValueSchema]),
  lineOpacities: z.tuple([
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
  ]),
  // Per-orb-module slider values (moduleId -> settingId -> value). Optional so
  // existing config files stay valid; without it zod's strip mode would drop
  // the field whenever the legacy config.dashboard.avatar path round-trips.
  orbModuleSettings: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  // Colour of the voice-listening glow behind the orb. Optional for the same
  // round-trip reason as orbModuleSettings above (the authoritative per-variant
  // theme avatar carries it via normalizeNovaAvatarTheme).
  voiceGlowColor: ThemeColorValueSchema.optional(),
});

/**
 * Smart doorbell: knock + presence fusion, alerts, and the gated unlock path.
 *
 * This is the PUBLIC half only. Secret-knock rhythm templates are an unlock
 * credential and the shared config is served to every browser on the network,
 * so templates live encrypted in data/doorbell-secrets.json.enc and only their
 * metadata (id, label, whether it is configured) appears here.
 *
 * Every field is defaulted so existing config files keep validating; access is
 * off by default so enabling the unlock path is always a deliberate act.
 */
export const DoorbellScheduleSchema = z.object({
  id: z.string().min(1),
  windows: z
    .array(
      z.object({
        /** 0 = Sunday, matching Date#getDay. */
        daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
        /** "HH:MM" local to access.timezone. end < start crosses midnight. */
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .default([]),
  /** "YYYY-MM-DD" dates on which this schedule never grants access. */
  denyDates: z.array(z.string()).default([]),
});

export const DoorbellSecretMetaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  configured: z.boolean().default(false),
  scheduleIds: z.array(z.string()).default([]),
  maxSuccessfulUses: z.number().int().min(1).nullable().default(null),
  successfulUses: z.number().int().min(0).default(0),
});

export const DoorbellConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    deviceId: z.string().default("front-door"),
    fusion: z
      .object({
        /** The stated requirement is three. Below two is not a doorbell. */
        minimumKnocks: z.number().int().min(2).max(16).default(3),
        presenceLeadMs: millisecondsSchema.default(2_000),
        presenceTrailMs: millisecondsSchema.default(2_000),
        notificationCooldownMs: millisecondsSchema.default(15_000),
      })
      .prefault({}),
    alerts: z
      .object({
        visualTimeoutMs: millisecondsSchema.default(12_000),
        visitorSoundAssetId: z.string().default("doorbell-visitor"),
        authorizedSoundAssetId: z.string().default("doorbell-authorized"),
        failureSoundAssetId: z.string().default("doorbell-failed"),
      })
      .prefault({}),
    access: z
      .object({
        /** Master switch. Off means notification-only, whatever else is set. */
        enabled: z.boolean().default(false),
        mode: z.enum(["notify_only", "unlock"]).default("notify_only"),
        timezone: z.string().default("Pacific/Auckland"),
        requirePresence: z.boolean().default(true),
        failedAttemptLimit: z.number().int().min(1).max(50).default(5),
        lockoutMs: millisecondsSchema.default(900_000),
        /** Best match must beat the runner-up by this much to count. */
        ambiguityMargin: z.number().min(0).max(1).default(0.2),
        /** The HA lock entity. Null means notification-only regardless. */
        lockEntityId: z.string().nullable().default(null),
      })
      .prefault({}),
    schedules: z.array(DoorbellScheduleSchema).default([]),
    secrets: z.array(DoorbellSecretMetaSchema).default([]),
  })
  .prefault({});

export const DashboardConfigSchema = z.object({
  schemaVersion: z.literal(DASHBOARD_CONFIG_SCHEMA_VERSION),
  homeAssistant: z.object({
    controlDomains: z.array(HaDomainSchema).min(1),
    illuminationNamePattern: z.string().min(1),
    supportSwitchPattern: z.string().min(1),
    everythingExcludedEntityIds: stringListSchema,
    climateAreaNames: stringListSchema,
    networkZoneId: z.string().min(1),
    weatherEntityId: entityIdSchema,
    sunEntityId: entityIdSchema,
    loungeSensorEntityIds: stringListSchema,
    router: z.object({
      name: z.string().min(1),
      wanStatusEntityId: entityIdSchema,
      externalIpEntityId: entityIdSchema,
      downloadSpeedEntityId: entityIdSchema,
      uploadSpeedEntityId: entityIdSchema,
    }),
    novaAssistSatelliteEntityId: entityIdSchema,
    // Entity-driven classification overrides. Home Assistant metadata
    // (device_class, area assignment, area sensor bindings, labels) is the
    // primary signal; the lists below are HA labels to honour plus explicit
    // entity-id escape hatches for when that metadata is missing or wrong.
    // Empty everywhere == pure HA-driven classification.
    classification: z
      .object({
        illuminationLabels: z.array(z.string().min(1)).default(["nova_illumination"]),
        hiddenLabels: z.array(z.string().min(1)).default(["nova_hidden"]),
        environmentLabels: z.array(z.string().min(1)).default(["nova_environment"]),
        forceIlluminationEntityIds: stringListSchema,
        forceHiddenEntityIds: stringListSchema,
        environmentSensorEntityIds: stringListSchema,
        environmentSensorExcludeEntityIds: stringListSchema,
      })
      .default({
        illuminationLabels: ["nova_illumination"],
        hiddenLabels: ["nova_hidden"],
        environmentLabels: ["nova_environment"],
        forceIlluminationEntityIds: [],
        forceHiddenEntityIds: [],
        environmentSensorEntityIds: [],
        environmentSensorExcludeEntityIds: [],
      }),
  }),
  dashboard: z.object({
    defaultZoneId: z.string().min(1),
    specialZones: z.object({
      power: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      }),
      tasks: z.object({
        id: z.string().min(1),
        name: z.string().min(1),
      }),
    }),
    lighting: z.object({
      intensityThresholds: z.array(LightingIntensityThresholdSchema).default([]),
      entityPresets: z.array(LightingEntityPresetSchema).default([]),
    }),
    aircon: z.object({
      offTimerIncrementMinutes: z.number().int().min(AIRCON_OFF_TIMER_INCREMENT_MINUTES_MIN).max(AIRCON_OFF_TIMER_INCREMENT_MINUTES_MAX),
    }),
    // The bedroom heater is a bare switch with onboard climate sensors; Nova
    // owns the thermostat loop (lib/bedroom-heater-control.ts). Entity ids are
    // listed most-preferred first so a LAN twin can be put ahead of the cloud
    // one later without touching code. Empty lists == no card.
    //
    // temperatureEntityIds deliberately leads with the standalone room puck
    // rather than the switch's own sensor, and that ordering is the whole
    // calibration story — do not "tidy" it back.
    //
    // The switch's onboard sensor cannot measure the room. Measured against a
    // co-located reference over 11 hours on 2026-08-08, while the room moved
    // 4.8 C it moved 0.84 C — a gain of about 0.27 with a ~30 minute lag, so
    // its error against the truth ranged from +0.7 to +4.8 C depending only on
    // where the room happened to be. No offset or curve fixes that; a signal
    // that cannot see the room heating cannot close a thermostat loop. (The
    // device also exposes a second, livelier temperature register that the
    // Tuya app displays, but it reads the switch body: it sat 7.8 C above an
    // unheated room while carrying 2 kW. Neither register is the air.)
    //
    // Order matters for safety, not just preference. The onboard sensor is kept
    // as a LAST resort because it reads HIGH, so falling back to it makes the
    // thermostat under-heat rather than cook a room nobody is measuring.
    // Dropping it entirely would be worse, not safer: with no temperature at
    // all the planner takes no action, which leaves a running 2 kW element on
    // until the schedule's auto-off edge.
    bedroomHeater: z
      .object({
        switchEntityIds: stringListSchema,
        temperatureEntityIds: stringListSchema,
        humidityEntityIds: stringListSchema,
      })
      .default({ switchEntityIds: [], temperatureEntityIds: [], humidityEntityIds: [] }),
    // The original panel heater died in August 2026 and was replaced by the
    // bedroom heater above. Its card is retained but hidden; set this true to
    // bring it back if an equivalent unit is installed.
    legacyPanelHeaterCardEnabled: z.boolean().default(false),
    camera: z.object({
      outside: z.object({
        // Pre-configured video host: where the Outside camera stream is served
        // FROM. Capture + hardware-encode live on the camera host; the
        // dashboard host is a pure consumer that embeds the stream directly
        // from this base URL (e.g. "http://camera-host.local:8080"). Empty =
        // fall back to the dashboard's own same-origin /api/camera routes.
        videoHostUrl: z.string().default(""),
        // Master switch for the Outside camera. When false, NO ffmpeg ingestion
        // runs at all — neither the real capture nor the synthetic test-pattern
        // fallback — so the camera stops competing for CPU on a contended box.
        // Defaults on so existing configs (and the shipped contract) keep the DVR.
        // NOTE: with a videoHostUrl set, ingestion + processing are owned by the
        // remote service (its /settings API); these nova fields remain only for
        // the same-origin fallback path and are ignored once the host is remote.
        ingestionEnabled: z.boolean().default(true),
        processing: z.object({
          brightness: z.number().min(-1).max(1),
          contrast: z.number().min(0).max(2),
          sharpness: z.number().min(0).max(5),
        }),
      }),
    }),
    avatar: NovaAvatarConfigSchema,
    // The reminder sigil bar between the clock and zones panels. Presentation
    // and thresholds only — which reminder owns which sigil lives in its own
    // store (lib/reminder-icons.ts) because it is keyed on reminder name and
    // churns as reminders come and go, which is not what a config file is for.
    reminders: z
      .object({
        outlineShape: z.enum(["rounded-rect", "circle", "square"]).default("rounded-rect"),
        /** How long past its end a reminder must sit before the tile pulses. */
        overduePulseAfterMs: millisecondsSchema.default(86_400_000),
        /** Tile opacity when nothing is due for that reminder. */
        inactiveOpacity: z.number().min(0).max(1).default(0.5),
        maxTiles: z.number().int().min(1).max(16).default(10),
        /** How long after a tap the completion can still be held-to-undone. */
        undoWindowMs: millisecondsSchema.default(600_000),
        /** How long the press must be held to fire the undo. */
        undoHoldMs: millisecondsSchema.default(2_000),
        classifier: z
          .object({
            enabled: z.boolean().default(true),
            timeoutMs: millisecondsSchema.default(4_000),
          })
          .prefault({}),
      })
      .prefault({}),
    doorbell: DoorbellConfigSchema,
    timing: z.object({
      entityCommandHoldMs: millisecondsSchema,
      dashboardEventPollMs: millisecondsSchema,
      dashboardBuildEventPollMs: millisecondsSchema,
      dashboardEventHeartbeatMs: millisecondsSchema,
      dashboardEventPushDebounceMs: millisecondsSchema,
      lightCommandEventHoldMs: millisecondsSchema,
      weatherRefreshIntervalMs: millisecondsSchema,
      adaptiveLightingPollMs: millisecondsSchema,
      buildReloadAfterOutageMs: millisecondsSchema,
    }),
  }),
  mapWeather: z.object({
    center: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    radar: z.object({
      manifestUrl: urlTemplateSchema,
      fallbackHost: z.string().url(),
      refreshIntervalMs: millisecondsSchema,
      sourcePollMs: millisecondsSchema,
      preloadZoom: z.number().int().min(0).max(22),
      preloadRadius: z.number().int().min(0).max(6),
    }),
    satellite: z.object({
      tileUrlTemplate: urlTemplateSchema,
      attributionLabel: z.string().min(1),
      attributionUrl: z.string().url(),
      maxZoom: z.number().int().min(0).max(22),
    }),
  }),
  power: z.object({
    timeZone: z.string().min(1),
    billing: z.object({
      startDay: dayOfMonthSchema,
      endDay: dayOfMonthSchema,
    }),
    timing: z.object({
      sampleIntervalMs: millisecondsSchema,
      haPublishIntervalMs: millisecondsSchema,
      discoveryIntervalMs: millisecondsSchema,
      rateCheckIntervalMs: millisecondsSchema,
      maxIntegrationHours: z.number().positive(),
    }),
    rates: z.object({
      pageUrl: z.string().url(),
      ratecardUrl: z.string().url(),
    }),
    modeledBaseLoads: z.object({
      desktopActiveStartHour: z.number().min(0).max(24),
      desktopActiveEndHour: z.number().min(0).max(24),
      desktopActiveWatts: z.number().nonnegative(),
      desktopStandbyWatts: z.number().nonnegative(),
      novaAioAverageWatts: z.number().nonnegative(),
      aucklandMonthlyTempsC: z.array(z.number()).length(12),
      monthWeights: z.array(z.number().positive()).length(12),
    }),
  }),
  tasks: z.object({
    iCloud: z.object({
      caldavUrl: z.string().url(),
      defaultSyncDays: z.number().int().min(1).max(60),
      calendars: stringListSchema,
      reminders: stringListSchema,
      syncIntervalMs: millisecondsSchema,
      defaultReminderDurationMs: millisecondsSchema,
      authBackoffMs: millisecondsSchema,
    }),
    alertAudio: z.object({
      fileName: z.string().min(1),
      maxBytes: z.number().int().positive(),
      alertWindowMs: millisecondsSchema,
      repeatMs: millisecondsSchema,
    }),
  }),
  theme: z.object({
    defaultScope: z.enum(["shared", "local"]),
    sharedThemePollMs: millisecondsSchema,
  }),
  mcp: z.object({
    enabled: z.boolean(),
    requireBearerAuth: z.boolean(),
    allowedOrigins: stringListSchema,
    enableMutations: z.boolean(),
    mutatingToolsRequireConfirm: z.boolean(),
  }),
  update: z.object({
    // GitHub "owner/repo" the live install tracks for self-updates.
    repo: z.string().min(1),
    // Branch whose HEAD counts as the latest available version.
    branch: z.string().min(1),
    // Default for the auto-update switch; the live toggle is stored in
    // runtime preferences so flipping it never rewrites the whole config.
    autoUpdate: z.boolean(),
    // Local hour (0-23, in power.timeZone) for the once-a-day update check.
    checkHourLocal: z.number().int().min(0).max(23),
  }),
});

export type DashboardConfigV1 = z.infer<typeof DashboardConfigSchema>;
export type DashboardConfig = DashboardConfigV1;

export type ConfigValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type ConfigValidationResult =
  | {
      ok: true;
      config: DashboardConfig;
      errors: [];
    }
  | {
      ok: false;
      config?: undefined;
      errors: ConfigValidationIssue[];
    };

export type ConfigImportResult = ConfigValidationResult & {
  applied: boolean;
};

export type SecretSetupStatus = {
  homeAssistant: {
    urlConfigured: boolean;
    tokenConfigured: boolean;
  };
  iCloud: {
    usernameConfigured: boolean;
    appPasswordConfigured: boolean;
    enabled: boolean;
  };
  powershop: {
    emailConfigured: boolean;
    passwordConfigured: boolean;
    enabled: boolean;
  };
  mcp: {
    bearerTokenConfigured: boolean;
    authRequired: boolean;
  };
};

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};
