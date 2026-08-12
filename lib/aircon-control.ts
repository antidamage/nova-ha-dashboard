import type { AirconPreferences, DashboardEntity, DashboardPreferences, HaDomain } from "./types";
import { autonomousClimateInputIsUsable } from "./autonomous-climate-safety";
import { settlingTrendSupportsSameDirectionRestart } from "./climate-control-policy";

export type EntityActionInput = {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
};

export const AIRCON_AUTO_POLL_MS = 1_000;

/*
 * Guard sizes. These are set against the SENSOR, not against comfort.
 *
 * Auto measures the Gree's own return-air thermistor (see
 * airconAutoMeasuredTemperature), which sits downstream of the compressor it is
 * controlling. On 2026-08-09 that produced 7 compressor starts and 4 heat<->cool
 * reversals in 45 minutes, in the middle of winter: the unit reached target 22,
 * switched off, the fan stopped, the thermistor heat-soaked 22 -> 23 in ONE
 * SECOND, and the old +-1 C band read that as "the room is a degree too warm,
 * cool it". While cooling it then reported 23 -> 25 in two minutes, which no
 * room does. Every number below is chosen so that transient cannot reach the
 * actuator.
 */

/**
 * A reversal still needs this much evidence after the sensor has settled. The
 * reading swings 2-3 C on compressor transitions, so a smaller cross-direction
 * threshold could turn residual heat/cold around the indoor unit into a reversal.
 *
 * A target the USER moved bypasses this (see reopened, below) — the threshold
 * exists to ignore a drifting sensor, never to ignore a person.
 */
const AIRCON_AUTO_DIRECTION_CHANGE_DEGREES = 3;
/** The Gree reports whole degrees, so this is the smallest observable drift. */
const AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES = 1;
/** Gree current_temperature is quantised to whole degrees. */
export const AIRCON_SENSOR_RESOLUTION_DEGREES = 1;
/**
 * Conservative fallback for an off Gree sensor whose transient is ambiguous.
 *
 * Nova's 2026-08-11 HA history has the reading continue moving for 14-21
 * minutes after heat stops. Laboratory work on common enclosed HVAC room
 * sensors measured low-airflow cooling time constants around 9-11 minutes
 * (Hayashi et al., 2002, DOI 10.18948/shase.27.84_31); a first-order thermal
 * sensor is about 95% settled after three time constants. Thirty minutes is
 * therefore a conservative, evidence-based fallback for this unforced indoor
 * unit. A consistent same-direction trace may act earlier using the time
 * constant below, but never before the compressor dwell.
 *
 * This is intentionally asymmetric. A running sensor reaching target may stop
 * the unit immediately: a possibly early stop is safe, while a possibly early
 * start is the transition that caused the observed flip-flopping.
 */
export const AIRCON_SENSOR_SETTLE_MS = 30 * 60_000;
/**
 * First-order time constant used to extrapolate the post-stop equilibrium.
 * Published low-airflow means are about 9-11 minutes. This Gree's recent first
 * and second whole-degree corrections had medians of about 6.5 and 15.5
 * minutes, respectively, so 10 minutes is also centred on the local evidence.
 */
export const AIRCON_SENSOR_TIME_CONSTANT_MS = 10 * 60_000;
/** Flip-flop guard: having chosen a direction, hold it this long. */
const AIRCON_AUTO_MODE_HOLD_MS = 30 * 60_000;
/** Dwell before STARTING the compressor again, matching BEDROOM_HEATER_MIN_CYCLE_MS. */
const AIRCON_AUTO_MIN_CYCLE_MS = 10 * 60_000;
/** Retain one hour of start telemetry; it is not a start limit. */
const AIRCON_AUTO_STARTS_WINDOW_MS = 60 * 60_000;
/**
 * How long Auto is allowed to run with NO usable room-temperature reading
 * before it fails safe.
 *
 * The Gree's own thermistor (see airconAutoMeasuredTemperature) only pushes
 * fresh readings while the unit is actively running — while off, Home
 * Assistant reports the attribute stale or unavailable. Failing safe the
 * instant the reading is missing therefore deadlocks Auto: it can never turn
 * itself on, because turning on is the only thing that produces a reading.
 * This grace window lets Auto attempt to run first; only if the sensor is
 * STILL unusable after it does the unit switch off. The unified controller
 * then clears Auto, preventing an unattended retry until a later user action.
 */
const AIRCON_AUTO_SENSOR_GRACE_MS = 2 * 60_000;

export const AIRCON_MODES = ["heat", "cool", "fan_only", "auto"] as const;
export const AIRCON_FAN_STEPS = ["quiet", "low", "medium low", "medium", "medium high", "high", "turbo"] as const;

export type AirconMode = (typeof AIRCON_MODES)[number];
export type AirconFanStep = (typeof AIRCON_FAN_STEPS)[number];
type ActiveAirconMode = "heat" | "cool";

/*
 * Dashboard air-con control rules.
 *
 * This file is intentionally React-free and Home-Assistant-UI-free. The
 * dashboard component can render controls, but the behavior that decides heat,
 * cool, target temperature, fan speed, and remembered auto state lives here.
 *
 * The core invariant:
 *
 *   delta = measuredRoomTemperature - selectedTargetTemperature
 *
 * If delta is positive, the room is hotter than the target, so auto must cool.
 * If delta is negative, the room is colder than the target, so auto must heat.
 *
 * Dashboard "Auto" is not the Gree/Home Assistant HVAC auto mode. It is a tiny
 * thermostat loop owned by Nova. The loop chooses heat/cool and applies the
 * target; once the room reaches target it switches the unit OFF (homeostasis =
 * off). The dashboard still reads "Auto" because the remembered autoMode
 * preference, not the unit's on/off, drives the power display — so the unit just
 * rests off until the room drifts far enough out, at which point the loop turns
 * it on again.
 *
 * The hysteresis is asymmetric and deliberately so: cut off AT target, then
 * resume the SAME direction when either (a) a monotonic post-stop drift plus a
 * first-order equilibrium estimate says the unchanged target is still missed,
 * after the 10-minute compressor dwell, or (b) the conservative 30-minute
 * settling fallback expires. A direction reversal still needs three degrees of
 * evidence and never uses the early predictor. The last direction, transition
 * reading, and clocks are durable so every dashboard and reload agrees.
 *
 * Three transition guards sit on top, because the measurement cannot be trusted
 * to mean what it says:
 *
 *   - a 30-minute hold on changing direction (AIRCON_AUTO_MODE_HOLD_MS),
 *   - a directional first-order sensor model with a 30-minute fallback,
 *   - a 10-minute dwell before restarting the compressor,
 *
 * There is deliberately no starts-per-hour cap. Fixed Heat may heat again and
 * fixed Cool may cool again whenever the sensor model and compressor dwell
 * gates clear. The 10-minute hardware dwell remains the absolute lower bound.
 *
 * None of these guards can stop the unit turning OFF. Stopping is always safe and always
 * cheap; a guard that delays it would leave the unit driving the room the wrong
 * way. Only starting is rate-limited.
 *
 * The state below therefore has to survive a page reload, because a 30-minute
 * hold that resets whenever the kiosk reloads is not a hold. It is mirrored into
 * preferences.aircon by the same `remember` payloads the loop already writes on
 * every transition, and reconciled by the server climate controller.
 */

export type AirconAutoState = {
  /** The direction Auto last drove. Changing it is what AIRCON_AUTO_MODE_HOLD_MS holds. */
  lastMode: ActiveAirconMode | null;
  /** When that direction was chosen. */
  lastModeAt: number | null;
  /** Last on/off/mode change, for the minimum-cycle dwell. */
  lastTransitionAt: number | null;
  /** Sensor reading captured when the current off-settling transient began. */
  settlingFromTemperature: number | null;
  /** Start telemetry, oldest first, pruned to the trailing hour; never a limit. */
  recentStartsAt: number[];
  /**
   * Tracks the target so a setpoint the USER moved reopens a resting cycle.
   * Without it a new comfort request can sit behind the sensor-settling gate,
   * which reads as a dead control. Auto only ever writes back the target it read,
   * so it cannot trip this itself.
   */
  lastTargetTemperature: number | null;
  /**
   * When Auto first started trying to run without a usable sensor reading.
   * Null once a usable reading arrives or the fail-safe fires. Used to bound
   * AIRCON_AUTO_SENSOR_GRACE_MS — see its comment above.
   */
  sensorPendingSinceAt: number | null;
};

export const INITIAL_AIRCON_AUTO_STATE: AirconAutoState = {
  lastMode: null,
  lastModeAt: null,
  lastTransitionAt: null,
  settlingFromTemperature: null,
  recentStartsAt: [],
  lastTargetTemperature: null,
  sensorPendingSinceAt: null,
};

/**
 * Why the planner did what it did. Purely for the monitoring stream, and the
 * reason the 2026-08-09 flip-flop had to be reconstructed from Home Assistant's
 * own history: the telemetry recorded which services were sent but never which
 * direction was wanted, so a reversal was invisible in it.
 */
export type AirconAutoReason =
  | "no-entity"
  | "no-target"
  | "sensor-fail-safe-off"
  | "sensor-pending"
  | "driving"
  | "reached-target"
  | "resting"
  | "mode-hold"
  | "sensor-settling-hold"
  | "min-cycle-hold"
  | "unsupported-direction";

export type AirconAutoPlan = {
  actions: EntityActionInput[];
  nextState: AirconAutoState;
  reason: AirconAutoReason;
  /** The direction the planner wanted this tick, whether or not it was allowed. */
  wantedMode?: ActiveAirconMode;
};

export type AirconAutoPlanInput = {
  currentTemperature: number | null;
  entity?: DashboardEntity;
  forceRemember?: boolean;
  now?: number;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  /** Partial because it round-trips through preferences; missing keys read as "unknown". */
  state?: Partial<AirconAutoState>;
  turboSwitch?: DashboardEntity;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createInitialAirconAutoState(): AirconAutoState {
  return { ...INITIAL_AIRCON_AUTO_STATE };
}

function normalizeAirconAutoState(state?: Partial<AirconAutoState>): AirconAutoState {
  const merged = { ...INITIAL_AIRCON_AUTO_STATE, ...(state ?? {}) };
  return {
    ...merged,
    // This state round-trips through preferences, so the array can arrive absent
    // or as something other than an array. A malformed value must read as "no
    // starts recorded", never crash the loop that stops the compressor.
    recentStartsAt: Array.isArray(merged.recentStartsAt)
      ? merged.recentStartsAt.filter((at): at is number => typeof at === "number" && Number.isFinite(at))
      : [],
    sensorPendingSinceAt:
      typeof merged.sensorPendingSinceAt === "number" && Number.isFinite(merged.sensorPendingSinceAt)
        ? merged.sensorPendingSinceAt
        : null,
    settlingFromTemperature:
      typeof merged.settlingFromTemperature === "number" && Number.isFinite(merged.settlingFromTemperature)
        ? merged.settlingFromTemperature
        : null,
  };
}

/** Compressor starts still inside the trailing hour, oldest first. */
function startsInWindow(recentStartsAt: number[], now: number) {
  return recentStartsAt.filter((at) => now - at < AIRCON_AUTO_STARTS_WINDOW_MS).sort((a, b) => a - b);
}

export function stringListAttribute(entity: DashboardEntity, name: string) {
  const value = entity.attributes[name];
  return Array.isArray(value) ? value.map(String) : [];
}

export function numericClimateAttribute(entity: Pick<DashboardEntity, "attributes">, name: string) {
  const raw = entity.attributes[name];
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function climateTargetTemperature(entity: DashboardEntity) {
  return numericClimateAttribute(entity, "temperature") ?? numericClimateAttribute(entity, "current_temperature");
}

export function climateCurrentTemperature(entity: Pick<DashboardEntity, "attributes">) {
  return numericClimateAttribute(entity, "current_temperature");
}

export function isClimateEntityOn(entity: DashboardEntity) {
  return !["off", "unavailable", "unknown"].includes(entity.state);
}

export function isAirconMode(value?: string): value is AirconMode {
  return AIRCON_MODES.some((mode) => mode === value);
}

export function airconEntityMode(entity: DashboardEntity) {
  return isAirconMode(entity.state) ? entity.state : undefined;
}

export function displayedAirconMode(entity: DashboardEntity, settings: AirconPreferences): AirconMode | undefined {
  if (settings.autoMode) {
    return "auto";
  }

  const selectedMode = isAirconMode(settings.hvacMode) ? settings.hvacMode : undefined;
  const entityMode = airconEntityMode(entity);

  if (entityMode && selectedMode && entityMode !== selectedMode && isClimateEntityOn(entity)) {
    return entityMode;
  }

  return selectedMode ?? entityMode;
}

export function airconModeSupported(supportedModes: string[], mode: AirconMode) {
  return supportedModes.length === 0 || supportedModes.includes(mode);
}

export function airconAutoSupported(supportedModes: string[]) {
  return supportedModes.length === 0 || (supportedModes.includes("heat") && supportedModes.includes("cool"));
}

// The aircon's own sensor is the measurement the auto loop acts on. It used to
// prefer the third-party lounge sensor; that sensor is being relocated, so the
// unit is the source now.
type AirconTemperatureSource = Pick<
  DashboardEntity,
  "attributes" | "entity_id" | "state" | "last_changed" | "last_updated" | "last_reported"
>;

export function airconAutoMeasuredTemperature(entity?: AirconTemperatureSource, now: number = Date.now()) {
  const measurement = entity ? climateCurrentTemperature(entity) : null;
  return autonomousClimateInputIsUsable(
    entity
      ? {
          measurement,
          sourceState: entity.state,
          last_changed: entity.last_changed,
          last_updated: entity.last_updated,
          last_reported: entity.last_reported,
        }
      : undefined,
    now,
  )
    ? measurement
    : null;
}

function airconIdentityText(entity: Pick<DashboardEntity, "attributes" | "entity_id">) {
  return `${entity.entity_id} ${String(entity.attributes.friendly_name ?? "")}`.toLowerCase();
}

/**
 * Locate Nova's autonomous air conditioner without ever falling back to a
 * heater. Both the browser controller and the server watchdog use this exact
 * selector so the safety monitor cannot watch a different device from Auto.
 */
export function dashboardAirconEntity<T extends Pick<DashboardEntity, "attributes" | "entity_id">>(
  entities: readonly T[],
) {
  const climates = entities.filter((entity) => entity.entity_id.startsWith("climate."));
  const explicit = climates.find((entity) =>
    ["air conditioner", "air con", "gree", "c6780cad"].some((token) => airconIdentityText(entity).includes(token)),
  );
  if (explicit) {
    return explicit;
  }
  return climates.find((entity) => !["heater", "panel"].some((token) => airconIdentityText(entity).includes(token)));
}

export function airconFanStep(
  entity: DashboardEntity,
  quietSwitch?: DashboardEntity,
  turboSwitch?: DashboardEntity,
): AirconFanStep {
  if (quietSwitch?.state === "on") {
    return "quiet";
  }
  if (turboSwitch?.state === "on") {
    return "turbo";
  }

  const mode = String(entity.attributes.fan_mode ?? "").toLowerCase();
  return AIRCON_FAN_STEPS.includes(mode as AirconFanStep) && mode !== "quiet" && mode !== "turbo"
    ? (mode as AirconFanStep)
    : "medium";
}

export function airconFanModeServiceValue(step: AirconFanStep) {
  return step === "quiet" ? "low" : step === "turbo" ? "high" : step;
}

function desiredModeForDelta(delta: number): ActiveAirconMode {
  return delta > 0 ? "cool" : "heat";
}

/**
 * How far past the room reading a user-chosen target has to land before it counts
 * as asking for the other direction.
 */
export const AIRCON_INTENT_MARGIN_DEGREES = 1;

/**
 * The direction a target the USER just set implies — or undefined when it does
 * not clearly imply one.
 *
 * This is what may break the 30-minute direction hold, and the distinction it
 * draws is the whole point: nudging the target a degree while the room sits near
 * it is a comfort tweak and means nothing about direction, whereas dropping the
 * target well below the room is unambiguously "cool the room". Only the latter
 * is honoured. It must only ever be called from a user gesture handler, never
 * from the loop — a target that merely drifted relative to the reading is not a
 * request.
 */
export function airconUserModeIntent(
  targetTemperature: number,
  measuredTemperature: number | null,
): ActiveAirconMode | undefined {
  if (measuredTemperature === null || !Number.isFinite(targetTemperature)) {
    return undefined;
  }
  if (targetTemperature < measuredTemperature - AIRCON_INTENT_MARGIN_DEGREES) {
    return "cool";
  }
  if (targetTemperature > measuredTemperature + AIRCON_INTENT_MARGIN_DEGREES) {
    return "heat";
  }
  return undefined;
}

export function airconFanStepForTemperatureDelta(delta: number): AirconFanStep {
  const degreeSteps = Math.max(1, Math.floor(Math.abs(delta)));
  const index = clampNumber(degreeSteps - 1, 0, AIRCON_FAN_STEPS.length - 1);
  return AIRCON_FAN_STEPS[index] ?? "quiet";
}

/**
 * The cycle bookkeeping, as preferences.
 *
 * This rides along on the `remember` payloads the loop already sends with every
 * transition, so it costs no extra preference write and no extra
 * preferences-history revision. It exists because the thermostat state otherwise
 * lives in a per-tab ref: a 30-minute direction hold that resets whenever the
 * kiosk reloads (which it does on every deploy) would not be a hold at all, and
 * two open dashboards would each keep their own idea of when the compressor last
 * started.
 */
export function airconAutoCycleRemember(state: AirconAutoState): AirconPreferences {
  return {
    autoLastMode: state.lastMode,
    autoLastModeAt: state.lastModeAt,
    autoLastTransitionAt: state.lastTransitionAt,
    autoRecentStartsAt: state.recentStartsAt,
    autoSettlingFromTemperature: state.settlingFromTemperature,
    autoSensorPendingSinceAt: state.sensorPendingSinceAt,
  };
}

/** The cycle bookkeeping, read back out of preferences. */
export function airconAutoCycleStateFromPreferences(
  preferences?: AirconPreferences,
): Partial<AirconAutoState> {
  return {
    lastMode: preferences?.autoLastMode ?? null,
    lastModeAt: preferences?.autoLastModeAt ?? null,
    lastTransitionAt: preferences?.autoLastTransitionAt ?? null,
    recentStartsAt: preferences?.autoRecentStartsAt ?? [],
    settlingFromTemperature: preferences?.autoSettlingFromTemperature ?? null,
    sensorPendingSinceAt: preferences?.autoSensorPendingSinceAt ?? null,
  };
}

function activeAutoRemember(
  targetTemperature: number,
  mode: ActiveAirconMode,
  fanStep: AirconFanStep,
  cycle: AirconAutoState,
): AirconPreferences {
  return {
    autoMode: true,
    fanMode: airconFanModeServiceValue(fanStep),
    hvacMode: mode,
    quietMode: fanStep === "quiet",
    temperature: targetTemperature,
    turboMode: fanStep === "turbo",
    ...airconAutoCycleRemember(cycle),
  };
}

function inactiveAutoRemember(
  targetTemperature: number,
  mode?: string,
  cycle?: AirconAutoState,
): AirconPreferences {
  return {
    autoMode: true,
    hvacMode: mode,
    temperature: targetTemperature,
    ...(cycle ? airconAutoCycleRemember(cycle) : {}),
  };
}

function autoPlanState(state: AirconAutoState, overrides: Partial<AirconAutoState>): AirconAutoState {
  return { ...state, ...overrides };
}

function noAirconActions(
  state: AirconAutoState,
  reason: AirconAutoReason,
  overrides: Partial<AirconAutoState> = {},
): AirconAutoPlan {
  return {
    actions: [],
    nextState: autoPlanState(state, overrides),
    reason,
  };
}

function airconSupportsHvacMode(entity: DashboardEntity, mode: string) {
  const supportedModes = stringListAttribute(entity, "hvac_modes");
  return supportedModes.length === 0 || supportedModes.includes(mode);
}

export function airconFanStepActions({
  entity,
  quietSwitch,
  remember,
  step,
  turboSwitch,
}: {
  entity: DashboardEntity;
  quietSwitch?: DashboardEntity;
  remember?: AirconPreferences;
  step: AirconFanStep;
  turboSwitch?: DashboardEntity;
}) {
  const actions: EntityActionInput[] = [];
  const quietEnabled = step === "quiet";
  const turboEnabled = step === "turbo";
  const fanMode = airconFanModeServiceValue(step);

  if (quietSwitch && (quietSwitch.state === "on") !== quietEnabled) {
    actions.push({
      entityId: quietSwitch.entity_id,
      domain: "switch",
      service: quietEnabled ? "turn_on" : "turn_off",
    });
  }
  if (turboSwitch && (turboSwitch.state === "on") !== turboEnabled) {
    actions.push({
      entityId: turboSwitch.entity_id,
      domain: "switch",
      service: turboEnabled ? "turn_on" : "turn_off",
    });
  }
  if (String(entity.attributes.fan_mode ?? "").toLowerCase() !== fanMode) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_fan_mode",
      data: { fan_mode: fanMode },
    });
  }

  if (remember && actions.length) {
    actions[actions.length - 1] = {
      ...actions[actions.length - 1],
      remember: { aircon: remember },
    };
  }

  return actions;
}

function activeAutoActions({
  cycle,
  desiredMode,
  entity,
  fanStep,
  forceRemember,
  quietSwitch,
  targetTemperature,
  turboSwitch,
}: {
  cycle: AirconAutoState;
  desiredMode: ActiveAirconMode;
  entity: DashboardEntity;
  fanStep: AirconFanStep;
  forceRemember: boolean;
  quietSwitch?: DashboardEntity;
  targetTemperature: number;
  turboSwitch?: DashboardEntity;
}) {
  const isOn = isClimateEntityOn(entity);
  const remember = activeAutoRemember(targetTemperature, desiredMode, fanStep, cycle);
  const actions: EntityActionInput[] = [];
  const modeNeedsChange = entity.state !== desiredMode || forceRemember;

  // set_hvac_mode turns the unit on by itself, so a turn_on in front of it buys
  // nothing and costs a real state change in the OLD mode: the 2026-08-09
  // logbook shows turn_on -> "heat" followed 90 ms later by
  // set_hvac_mode -> "cool", three times. Only turn_on when no mode change is
  // going out to do it for us.
  if (!isOn && !modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "turn_on",
    });
  }

  if (modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_hvac_mode",
      data: { hvac_mode: desiredMode },
      remember: { aircon: remember },
    });
  }

  if (!isOn || climateTargetTemperature(entity) !== targetTemperature || modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_temperature",
      data: { hvac_mode: desiredMode, temperature: targetTemperature },
      remember: { aircon: remember },
    });
  }

  actions.push(...airconFanStepActions({ entity, quietSwitch, remember, step: fanStep, turboSwitch }));

  return actions;
}

// When the room reaches target (or auto is not allowed to drive it in the needed
// direction), the loop switches the unit OFF. This is idempotent: an already-off
// unit yields no actions, so the 1s loop stops re-sending once it has switched
// off. The remembered preference keeps autoMode:true, so the dashboard still
// reads "Auto" while the unit rests off rather than flipping to "Off".
function offAutoActions({
  cycle,
  entity,
  selectedMode,
  targetTemperature,
}: {
  cycle: AirconAutoState;
  entity: DashboardEntity;
  selectedMode?: string;
  targetTemperature: number;
}): EntityActionInput[] {
  if (!isClimateEntityOn(entity)) {
    return [];
  }

  return [
    {
      entityId: entity.entity_id,
      domain: "climate",
      service: "turn_off",
      remember: { aircon: inactiveAutoRemember(targetTemperature, selectedMode, cycle) },
    },
  ];
}

/** Is the unit actively driving the room in one of the two directions Auto uses? */
function drivingMode(entity: DashboardEntity): ActiveAirconMode | undefined {
  if (!isClimateEntityOn(entity)) {
    return undefined;
  }
  return entity.state === "heat" || entity.state === "cool" ? entity.state : undefined;
}

export function planAirconAutoTick({
  currentTemperature,
  entity,
  forceRemember = false,
  now = Date.now(),
  preferences,
  quietSwitch,
  state,
  turboSwitch,
}: AirconAutoPlanInput): AirconAutoPlan {
  let currentState = normalizeAirconAutoState(state);

  if (!entity) {
    return noAirconActions(currentState, "no-entity");
  }

  const targetTemperature = climateTargetTemperature(entity) ?? preferences?.temperature;
  if (targetTemperature == null || !Number.isFinite(targetTemperature)) {
    return noAirconActions(currentState, "no-target", { lastTargetTemperature: null });
  }

  const selectedMode = isAirconMode(preferences?.hvacMode) ? preferences?.hvacMode : undefined;

  // A target the user moved, versus one that merely differs from a fresh (null)
  // state. Only the former reopens a resting cycle. Computed before the
  // sensor-null branch below because a fresh command also restarts the sensor
  // grace clock — see reopened's use there.
  const targetChanged =
    currentState.lastTargetTemperature !== null && currentState.lastTargetTemperature !== targetTemperature;
  // A setpoint change reopens the comfort decision, but it must not erase the
  // compressor dwell, direction hold, or diagnostic start history.
  const reopened = targetChanged || forceRemember;
  const recentStartsAt = startsInWindow(currentState.recentStartsAt, now);

  if (currentTemperature === null) {
    // pendingSinceAt tracks when Auto FIRST started running blind. A reopened
    // cycle (user changed the target, or just pressed Auto) gets a fresh grace
    // window rather than inheriting a clock that may already be near expiry.
    const pendingSinceAt = reopened ? now : (currentState.sensorPendingSinceAt ?? now);
    const elapsedMs = now - pendingSinceAt;
    const pendingBase = autoPlanState(currentState, {
      recentStartsAt,
      lastTargetTemperature: targetTemperature,
    });

    if (elapsedMs >= AIRCON_AUTO_SENSOR_GRACE_MS) {
      // Ran blind for the whole grace window and still no usable reading. The
      // planner emits the safe stop; the unified controller clears Auto.
      const cycle = autoPlanState(pendingBase, {
        sensorPendingSinceAt: null,
        lastTransitionAt: now,
        settlingFromTemperature: currentTemperature,
      });
      return {
        actions: offAutoActions({ cycle, entity, selectedMode, targetTemperature }),
        nextState: cycle,
        reason: "sensor-fail-safe-off",
      };
    }

    // Still inside the grace window: try to run rather than sit off waiting for
    // a reading that (per airconAutoMeasuredTemperature) only arrives once the
    // unit is actually running. Without a delta to compute a direction from,
    // drive whichever direction is already running, or failing that the
    // user's selected Heat/Cool — never guess between them.
    const pendingState = autoPlanState(pendingBase, { sensorPendingSinceAt: pendingSinceAt });
    const runningNow = drivingMode(entity);
    const attemptMode: ActiveAirconMode | undefined =
      runningNow ?? (selectedMode === "heat" || selectedMode === "cool" ? selectedMode : undefined);

    if (!attemptMode || !airconSupportsHvacMode(entity, attemptMode) || runningNow) {
      // Nothing safe to try (no direction, or unsupported), or already trying —
      // just let the clock run out.
      return { actions: [], nextState: pendingState, reason: "sensor-pending", wantedMode: attemptMode };
    }

    // Respect the hardware guards even for a blind attempt, so a sensor that
    // flaps between missing and present cannot short-cycle the compressor.
    const holdBlocked =
      (currentState.lastMode &&
        currentState.lastMode !== attemptMode &&
        currentState.lastModeAt !== null &&
        now - currentState.lastModeAt < AIRCON_AUTO_MODE_HOLD_MS) ||
      (currentState.lastTransitionAt !== null && now - currentState.lastTransitionAt < AIRCON_AUTO_MIN_CYCLE_MS);

    if (holdBlocked) {
      return { actions: [], nextState: pendingState, reason: "sensor-pending", wantedMode: attemptMode };
    }

    const modeChanged = currentState.lastMode !== attemptMode;
    const cycle: AirconAutoState = {
      ...pendingState,
      lastMode: attemptMode,
      lastModeAt: modeChanged ? now : (currentState.lastModeAt ?? now),
      lastTransitionAt: now,
      recentStartsAt: [...recentStartsAt, now],
      settlingFromTemperature: null,
    };

    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: attemptMode,
        entity,
        fanStep: "medium",
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      nextState: cycle,
      reason: "sensor-pending",
      wantedMode: attemptMode,
    };
  }

  const delta = currentTemperature - targetTemperature;
  const absDelta = Math.abs(delta);
  const running = drivingMode(entity);
  // A usable reading arrived: whatever blind-attempt clock was running is moot.
  const cycleBase: AirconAutoState = {
    ...currentState,
    recentStartsAt,
    lastTargetTemperature: targetTemperature,
    sensorPendingSinceAt: null,
  };

  // A person can deliberately move the target across the measured room
  // temperature to swap heating and cooling. Do that directly: stopping first
  // would create a brand-new dwell lock and defeat the override on the next
  // tick. The fresh-input gate has already passed above.
  // Reversals always stop first and pass through the normal off-dwell. A target
  // edit is not permission to drive heat and cool back-to-back.
  const changedTargetMode: ActiveAirconMode | null = null;
  if (
    running &&
    changedTargetMode &&
    changedTargetMode !== running &&
    airconSupportsHvacMode(entity, changedTargetMode)
  ) {
    const fanStep = airconFanStepForTemperatureDelta(delta);
    const cycle = autoPlanState(cycleBase, {
      lastMode: changedTargetMode,
      lastModeAt: now,
      lastTransitionAt: now,
      recentStartsAt: [now],
      settlingFromTemperature: null,
    });
    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: changedTargetMode,
        entity,
        fanStep,
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      nextState: cycle,
      reason: "driving",
      wantedMode: changedTargetMode,
    };
  }

  const rest = (reason: AirconAutoReason, overrides: Partial<AirconAutoState> = {}): AirconAutoPlan => {
    const base = autoPlanState(cycleBase, overrides);
    if (!isClimateEntityOn(entity)) {
      return { actions: [], nextState: base, reason };
    }
    // Stopping is never rate-limited, but it IS a transition: the dwell before the
    // next start counts from here. Stamp it BEFORE building the actions, because
    // the stamped value is what rides out on the turn_off's remember payload.
    const cycle = autoPlanState(base, {
      lastTransitionAt: now,
      settlingFromTemperature: currentTemperature,
    });
    return {
      actions: offAutoActions({ cycle, entity, selectedMode, targetTemperature }),
      nextState: cycle,
      reason,
    };
  };

  // ---- Already driving: run until the reading reaches target, then stop. ----
  //
  // While driving, the wanted direction cannot disagree with the running one —
  // "not yet at target" and "wanted the other way" are contradictory — so no
  // reversal is reachable from here at all. The asymmetric behavior is: stop at
  // target now, but only restart from the trusted post-settling reading below.
  if (running) {
    const reachedTarget = running === "heat" ? currentTemperature >= targetTemperature : currentTemperature <= targetTemperature;
    if (reachedTarget) {
      return rest("reached-target");
    }

    const fanStep = airconFanStepForTemperatureDelta(delta);
    const cycle = autoPlanState(cycleBase, {
      lastMode: running,
      lastModeAt: currentState.lastModeAt ?? now,
      settlingFromTemperature: null,
    });
    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: running,
        entity,
        fanStep,
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      // Continuing in the same direction is not a transition and not a start, so
      // neither clock is stamped. A fan step is not a compressor cycle.
      nextState: cycle,
      reason: "driving",
      wantedMode: running,
    };
  }

  // ---- Resting: decide whether to start, and whether we are allowed to. ----
  //
  // A target the user moved (or a freshly pressed Auto) only has to point away
  // from the room at all. Normal same-direction cycling resumes on the first
  // whole degree after the off sensor has settled; a reversal needs three.
  const wantedMode = desiredModeForDelta(delta);
  const resumeDegrees = currentState.lastMode && currentState.lastMode !== wantedMode
    ? AIRCON_AUTO_DIRECTION_CHANGE_DEGREES
    : AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES;
  const needsDriving = reopened ? absDelta > 0 : absDelta >= resumeDegrees;
  if (!needsDriving) {
    return rest("resting");
  }

  if (!airconSupportsHvacMode(entity, wantedMode)) {
    // Can't drive the room toward target in the needed direction; rest rather
    // than run uselessly.
    return { ...rest("unsupported-direction"), wantedMode };
  }

  // Flip-flop guard. Reversing direction is held for AIRCON_AUTO_MODE_HOLD_MS
  // from the last direction change, and resting is the honest answer while it
  // holds: running the old direction would drive the room further from target.
  // Note lastModeAt is deliberately NOT restamped — being blocked must not
  // extend the hold, or a persistently wrong reading would freeze Auto forever.
  // A user who actually wants the other direction clears it (ClimateControls).
  if (
    currentState.lastMode &&
    currentState.lastMode !== wantedMode &&
    currentState.lastModeAt !== null &&
    now - currentState.lastModeAt < AIRCON_AUTO_MODE_HOLD_MS
  ) {
    return { ...rest("mode-hold"), wantedMode };
  }

  const settlingElapsedMs = currentState.lastTransitionAt === null
    ? Number.POSITIVE_INFINITY
    : now - currentState.lastTransitionAt;
  const sameDirectionTrendSupportsRestart =
    currentState.lastMode === wantedMode &&
    settlingElapsedMs >= AIRCON_AUTO_MIN_CYCLE_MS &&
    settlingTrendSupportsSameDirectionRestart({
      direction: wantedMode,
      atTransition: currentState.settlingFromTemperature,
      current: currentTemperature,
      target: targetTemperature,
      elapsedMs: settlingElapsedMs,
      timeConstantMs: AIRCON_SENSOR_TIME_CONSTANT_MS,
      resumeDriftC: AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES,
      measurementResolutionC: AIRCON_SENSOR_RESOLUTION_DEGREES,
    });

  // A stopped indoor unit has almost no airflow over its enclosed sensor. Before
  // the full fallback timeout, start only when its monotonic post-stop trend and
  // first-order extrapolated equilibrium both say the unchanged target is still
  // unmet in the SAME direction. Ambiguous traces wait the full 30 minutes.
  if (
    !reopened &&
    currentState.lastTransitionAt !== null &&
    settlingElapsedMs < AIRCON_SENSOR_SETTLE_MS &&
    !sameDirectionTrendSupportsRestart
  ) {
    return { ...rest("sensor-settling-hold"), wantedMode };
  }

  // Minimum dwell before restarting the compressor. Unlike the bedroom heater's
  // equivalent this gates STARTS ONLY — see the header note on why a guard must
  // never be the reason the unit keeps running.
  //
  // rest() rather than "do nothing": on the normal path the unit is already off
  // and rest() emits nothing, but if it is sitting in fan_only or dry — a mode
  // Auto never selects, so someone else put it there — being held off a start is
  // no reason to leave it running.
  if (
    currentState.lastTransitionAt !== null &&
    now - currentState.lastTransitionAt < AIRCON_AUTO_MIN_CYCLE_MS
  ) {
    return { ...rest("min-cycle-hold"), wantedMode };
  }

  const fanStep = airconFanStepForTemperatureDelta(delta);
  const modeChanged = currentState.lastMode !== wantedMode;
  const cycle: AirconAutoState = {
    ...cycleBase,
    lastMode: wantedMode,
    lastModeAt: modeChanged ? now : currentState.lastModeAt ?? now,
    lastTransitionAt: now,
    recentStartsAt: [...recentStartsAt, now],
    settlingFromTemperature: null,
  };

  return {
    actions: activeAutoActions({
      cycle,
      desiredMode: wantedMode,
      entity,
      fanStep,
      forceRemember,
      quietSwitch,
      targetTemperature,
      turboSwitch,
    }),
    nextState: cycle,
    reason: "driving",
    wantedMode,
  };
}

export function buildAirconAutoActions(args: AirconAutoPlanInput) {
  return planAirconAutoTick(args).actions;
}

export class AirconAutoThermostat {
  private state = createInitialAirconAutoState();

  reset() {
    this.state = createInitialAirconAutoState();
  }

  /**
   * Clear the per-cycle bookkeeping for a user request WITHOUT clearing the
   * guards.
   *
   * reset() used to run on every autoMode transition, and on
   * a compressor that must not also wipe the dwell, the direction hold and the
   * start history — that is exactly how the bedroom heater ended up flapping
   * a 2 kW relay three times in twelve seconds on 2026-08-08. Breaking the
   * direction hold is a deliberate act with its own rules (see ClimateControls),
   * not a side effect of pressing a button.
   */
  resetForUserRequest() {
    this.state = {
      ...createInitialAirconAutoState(),
      lastMode: this.state.lastMode,
      lastModeAt: this.state.lastModeAt,
      lastTransitionAt: this.state.lastTransitionAt,
      recentStartsAt: this.state.recentStartsAt,
      settlingFromTemperature: this.state.settlingFromTemperature,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  /**
   * Fold durable cycle state (from preferences) into memory, keeping whichever
   * copy is further ahead. Preferences are shared across clients and survive a
   * reload; memory is fresher than the ≤5 s snapshot. Neither alone is enough.
   */
  reconcile(durable: Partial<AirconAutoState>) {
    const later = (a: number | null | undefined, b: number | null | undefined) =>
      Math.max(a ?? 0, b ?? 0) || null;
    const durableModeAt = durable.lastModeAt ?? 0;
    const memoryModeAt = this.state.lastModeAt ?? 0;
    const durableTransitionAt = durable.lastTransitionAt ?? 0;
    const memoryTransitionAt = this.state.lastTransitionAt ?? 0;
    this.state = {
      ...this.state,
      lastTransitionAt: later(this.state.lastTransitionAt, durable.lastTransitionAt),
      lastModeAt: later(memoryModeAt, durableModeAt),
      // The direction belongs to whichever hold started later, so a flip written
      // by another client is not silently reverted by this one's stale memory.
      lastMode: durableModeAt > memoryModeAt ? durable.lastMode ?? this.state.lastMode : this.state.lastMode,
      recentStartsAt: Array.from(new Set([...this.state.recentStartsAt, ...(durable.recentStartsAt ?? [])])),
      sensorPendingSinceAt: this.state.sensorPendingSinceAt ?? durable.sensorPendingSinceAt ?? null,
      settlingFromTemperature:
        durableTransitionAt > memoryTransitionAt
          ? durable.settlingFromTemperature ?? null
          : memoryTransitionAt > durableTransitionAt
            ? this.state.settlingFromTemperature
            : this.state.settlingFromTemperature ?? durable.settlingFromTemperature ?? null,
    };
  }

  plan(args: Omit<AirconAutoPlanInput, "state">) {
    const plan = planAirconAutoTick({ ...args, state: this.state });
    this.state = plan.nextState;
    return plan;
  }
}
