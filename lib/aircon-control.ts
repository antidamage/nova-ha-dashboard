import type { AirconPreferences, DashboardEntity, DashboardPreferences, HaDomain } from "./types";

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
 * Off at target, but do not restart until the reading is this far past it. Wide
 * hysteresis rather than a symmetric band: the reading swings 2-3 C on every
 * compressor transition, so a band narrower than that is noise, not measurement.
 *
 * A target the USER moved bypasses this (see reopened, below) — the threshold
 * exists to ignore a drifting sensor, never to ignore a person.
 */
const AIRCON_AUTO_RESUME_DEGREES = 3;
/**
 * Flip-flop guard: having chosen a direction, hold it this long. Also the
 * settling time the thermistor needs before its reading means anything again.
 * Caps Auto at two direction changes an hour.
 */
const AIRCON_AUTO_MODE_HOLD_MS = 30 * 60_000;
/** Dwell before STARTING the compressor again, matching BEDROOM_HEATER_MIN_CYCLE_MS. */
const AIRCON_AUTO_MIN_CYCLE_MS = 10 * 60_000;
const AIRCON_AUTO_MAX_STARTS_PER_HOUR = 3;
const AIRCON_AUTO_STARTS_WINDOW_MS = 60 * 60_000;

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
 * The hysteresis is asymmetric and deliberately so: cut off AT target, resume
 * only AIRCON_AUTO_RESUME_DEGREES past it. Which side of that hysteresis we are
 * on is read from the unit itself (is it running in heat or cool?) rather than
 * from a local flag, so every dashboard client and every page reload agree
 * without sharing anything.
 *
 * Three rate limits sit on top, because the measurement cannot be trusted to
 * mean what it says:
 *
 *   - a 30-minute hold on changing direction (AIRCON_AUTO_MODE_HOLD_MS),
 *   - a 10-minute dwell before restarting the compressor,
 *   - at most AIRCON_AUTO_MAX_STARTS_PER_HOUR starts in any hour.
 *
 * None of them can stop the unit turning OFF. Stopping is always safe and always
 * cheap; a guard that delays it would leave the unit driving the room the wrong
 * way. Only starting is rate-limited.
 *
 * The state below therefore has to survive a page reload, because a 30-minute
 * hold that resets whenever the kiosk reloads is not a hold. It is mirrored into
 * preferences.aircon by the same `remember` payloads the loop already writes on
 * every transition, and reconciled back in useAirconAutoMode.
 */

export type AirconAutoState = {
  /** The direction Auto last drove. Changing it is what AIRCON_AUTO_MODE_HOLD_MS holds. */
  lastMode: ActiveAirconMode | null;
  /** When that direction was chosen. */
  lastModeAt: number | null;
  /** Last on/off/mode change, for the minimum-cycle dwell. */
  lastTransitionAt: number | null;
  /** Compressor starts, oldest first, pruned to the trailing hour. */
  recentStartsAt: number[];
  /**
   * Tracks the target so a setpoint the USER moved reopens a resting cycle.
   * Without it a warmer target sits ignored until the room drifts three degrees,
   * which reads as a dead control. Auto only ever writes back the target it read,
   * so it cannot trip this itself.
   */
  lastTargetTemperature: number | null;
};

export const INITIAL_AIRCON_AUTO_STATE: AirconAutoState = {
  lastMode: null,
  lastModeAt: null,
  lastTransitionAt: null,
  recentStartsAt: [],
  lastTargetTemperature: null,
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
  | "no-temperature"
  | "driving"
  | "reached-target"
  | "resting"
  | "mode-hold"
  | "min-cycle-hold"
  | "starts-per-hour-hold"
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

export function numericClimateAttribute(entity: DashboardEntity, name: string) {
  const value = Number(entity.attributes[name]);
  return Number.isFinite(value) ? value : null;
}

export function climateTargetTemperature(entity: DashboardEntity) {
  return numericClimateAttribute(entity, "temperature") ?? numericClimateAttribute(entity, "current_temperature");
}

export function climateCurrentTemperature(entity: DashboardEntity) {
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
export function airconAutoMeasuredTemperature(entity?: DashboardEntity) {
  return entity ? climateCurrentTemperature(entity) : null;
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
  const currentState = normalizeAirconAutoState(state);

  if (!entity) {
    return noAirconActions(currentState, "no-entity");
  }

  const targetTemperature = climateTargetTemperature(entity) ?? preferences?.temperature;
  if (targetTemperature == null || !Number.isFinite(targetTemperature)) {
    return noAirconActions(currentState, "no-target", { lastTargetTemperature: null });
  }

  const selectedMode = isAirconMode(preferences?.hvacMode) ? preferences?.hvacMode : undefined;

  if (currentTemperature === null) {
    if (!forceRemember) {
      return noAirconActions(currentState, "no-temperature", { lastTargetTemperature: targetTemperature });
    }

    // The user pressed Auto but there is no reading to act on. Persist the
    // intent and nothing else.
    return {
      actions: [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature: targetTemperature },
          remember: { aircon: inactiveAutoRemember(targetTemperature, selectedMode, currentState) },
        },
      ],
      nextState: autoPlanState(currentState, { lastTargetTemperature: targetTemperature }),
      reason: "no-temperature",
    };
  }

  // A target the user moved, versus one that merely differs from a fresh (null)
  // state. Only the former reopens a resting cycle.
  const targetChanged =
    currentState.lastTargetTemperature !== null && currentState.lastTargetTemperature !== targetTemperature;
  const reopened = targetChanged || forceRemember;
  const delta = currentTemperature - targetTemperature;
  const absDelta = Math.abs(delta);
  const running = drivingMode(entity);
  const recentStartsAt = startsInWindow(currentState.recentStartsAt, now);
  const cycleBase: AirconAutoState = { ...currentState, recentStartsAt, lastTargetTemperature: targetTemperature };

  const rest = (reason: AirconAutoReason, overrides: Partial<AirconAutoState> = {}): AirconAutoPlan => {
    const base = autoPlanState(cycleBase, overrides);
    if (!isClimateEntityOn(entity)) {
      return { actions: [], nextState: base, reason };
    }
    // Stopping is never rate-limited, but it IS a transition: the dwell before the
    // next start counts from here. Stamp it BEFORE building the actions, because
    // the stamped value is what rides out on the turn_off's remember payload.
    const cycle = autoPlanState(base, { lastTransitionAt: now });
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
  // reversal is reachable from here at all. The asymmetric hysteresis lives in
  // the two thresholds: off AT target below, resume RESUME_DEGREES past it.
  if (running) {
    const reachedTarget = running === "heat" ? currentTemperature >= targetTemperature : currentTemperature <= targetTemperature;
    if (reachedTarget) {
      return rest("reached-target");
    }

    const fanStep = airconFanStepForTemperatureDelta(delta);
    const cycle = autoPlanState(cycleBase, { lastMode: running, lastModeAt: currentState.lastModeAt ?? now });
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
  // from the room at all; a drifting reading has to be RESUME_DEGREES out.
  const needsDriving = reopened ? absDelta > 0 : absDelta >= AIRCON_AUTO_RESUME_DEGREES;
  if (!needsDriving) {
    return rest("resting");
  }

  const wantedMode = desiredModeForDelta(delta);

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

  if (recentStartsAt.length >= AIRCON_AUTO_MAX_STARTS_PER_HOUR) {
    return { ...rest("starts-per-hour-hold"), wantedMode };
  }

  const fanStep = airconFanStepForTemperatureDelta(delta);
  const modeChanged = currentState.lastMode !== wantedMode;
  const cycle: AirconAutoState = {
    ...cycleBase,
    lastMode: wantedMode,
    lastModeAt: modeChanged ? now : currentState.lastModeAt ?? now,
    lastTransitionAt: now,
    recentStartsAt: [...recentStartsAt, now],
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
   * reset() is what useAirconAutoMode calls on every autoMode transition, and on
   * a compressor that must not also wipe the dwell, the direction hold and the
   * hourly start count — that is exactly how the bedroom heater ended up flapping
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
    this.state = {
      ...this.state,
      lastTransitionAt: later(this.state.lastTransitionAt, durable.lastTransitionAt),
      lastModeAt: later(memoryModeAt, durableModeAt),
      // The direction belongs to whichever hold started later, so a flip written
      // by another client is not silently reverted by this one's stale memory.
      lastMode: durableModeAt > memoryModeAt ? durable.lastMode ?? this.state.lastMode : this.state.lastMode,
      recentStartsAt: Array.from(new Set([...this.state.recentStartsAt, ...(durable.recentStartsAt ?? [])])),
    };
  }

  plan(args: Omit<AirconAutoPlanInput, "state">) {
    const plan = planAirconAutoTick({ ...args, state: this.state });
    this.state = plan.nextState;
    return plan;
  }
}
