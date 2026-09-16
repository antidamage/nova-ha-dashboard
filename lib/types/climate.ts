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
  /**
   * The latched owner request — see AirconAutoState.userRequestAt and
   * specs/aircon-auto-control.md §4. Durable so a request made seconds before a
   * deploy or a kiosk reload is still served afterwards.
   */
  autoUserRequestAt?: number | null;
  /** The change detector behind that latch; durable for the same reason. */
  autoLastTargetTemperature?: number | null;
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
 * There is no auto-on/auto-off window: the clock never changes the heater's
 * mode. Stored preferences from before 2026-08-19 may still carry
 * autoOnMinutes/autoOffMinutes; nothing reads them.
 */
export type BedroomHeaterMode = "auto" | "off";

export type BedroomHeaterPreferences = {
  /** "manual" is retired and read as "auto"; see bedroomHeaterMode(). */
  mode?: BedroomHeaterMode | "manual";
  temperature?: number;
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
  direction: "heat" | "cool" | "dry" | "fan_only" | null;
  /**
   * Dry is offered for a unit without native dry because its room has fresh-
   * capable humidity and temperature sensors configured (aircon instances only).
   */
  dryEmulatable?: boolean;
  sensorAvailable: boolean;
  sensorReportedAt: string | null;
  sensorGraceEndsAt: string | null;
  actuatorAvailable: boolean;
  overrideReason: string | null;
  lastStopReason: string | null;
  /**
   * An owner request the thermostat has latched but not yet acted on, ISO. For
   * diagnostics only — the climate card deliberately shows nothing for it
   * (specs/aircon-auto-control.md §3.4).
   */
  pendingUserRequestAt: string | null;
};

/**
 * Server-owned control state per climate instance, keyed by instance id (see
 * lib/climate-instances.ts). Was a fixed `{ lounge, bedroom }` pair, which is
 * also why the dashboard could only ever drive two devices.
 */
export type ClimateControlState = Record<string, ClimateControlRoomState>;
