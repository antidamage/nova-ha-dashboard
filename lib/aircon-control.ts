import type { AirconPreferences, DashboardEntity, DashboardPreferences, HaDomain } from "./types";

export type EntityActionInput = {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
};

export const AIRCON_AUTO_POLL_MS = 10_000;
const AIRCON_AUTO_BAND_DEGREES = 1;
const AIRCON_AUTO_TAIL_MS = 2 * 60_000;

export const AIRCON_MODES = ["heat", "cool", "fan_only", "auto"] as const;
export const AIRCON_FAN_STEPS = ["quiet", "low", "medium low", "medium", "medium high", "high", "turbo"] as const;

export type AirconMode = (typeof AIRCON_MODES)[number];
export type AirconFanStep = (typeof AIRCON_FAN_STEPS)[number];
type ActiveAirconMode = "heat" | "cool";

export type AirconTemperatureSource = {
  temperature: number | null;
};

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
 * thermostat loop owned by Nova. The loop chooses heat/cool, applies the target,
 * runs for a short tail after entering the +/- band, then turns the unit off.
 *
 * State matters because the lounge sensor updates slowly. After a deliberate
 * tail-off we hold until either the sensor value changes or the user changes the
 * target temperature. Tracking the last target prevents the old failure where a
 * new warm/cold target was ignored just because the sensor had not refreshed.
 */

export type AirconAutoState = {
  enteredBandAt: number | null;
  tailedOff: boolean;
  lastSensorTemperature: number | null;
  lastTargetTemperature: number | null;
};

export const INITIAL_AIRCON_AUTO_STATE: AirconAutoState = {
  enteredBandAt: null,
  tailedOff: false,
  lastSensorTemperature: null,
  lastTargetTemperature: null,
};

export type AirconAutoPlan = {
  actions: EntityActionInput[];
  nextState: AirconAutoState;
};

export type AirconAutoPlanInput = {
  currentTemperature: number | null;
  entity?: DashboardEntity;
  forceRemember?: boolean;
  now?: number;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  state?: AirconAutoState;
  turboSwitch?: DashboardEntity;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createInitialAirconAutoState(): AirconAutoState {
  return { ...INITIAL_AIRCON_AUTO_STATE };
}

function normalizeAirconAutoState(state?: AirconAutoState): AirconAutoState {
  return { ...INITIAL_AIRCON_AUTO_STATE, ...(state ?? {}) };
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

export function airconAutoMeasuredTemperature(
  entity?: DashboardEntity,
  loungeEnvironment?: AirconTemperatureSource | null,
) {
  return loungeEnvironment?.temperature ?? (entity ? climateCurrentTemperature(entity) : null);
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

export function airconFanStepForTemperatureDelta(delta: number): AirconFanStep {
  const degreeSteps = Math.max(1, Math.floor(Math.abs(delta)));
  const index = clampNumber(degreeSteps - 1, 0, AIRCON_FAN_STEPS.length - 1);
  return AIRCON_FAN_STEPS[index] ?? "quiet";
}

function activeAutoRemember(
  targetTemperature: number,
  mode: ActiveAirconMode,
  fanStep: AirconFanStep,
): AirconPreferences {
  return {
    autoMode: true,
    fanMode: airconFanModeServiceValue(fanStep),
    hvacMode: mode,
    quietMode: fanStep === "quiet",
    temperature: targetTemperature,
    turboMode: fanStep === "turbo",
  };
}

function inactiveAutoRemember(targetTemperature: number, mode?: string): AirconPreferences {
  return {
    autoMode: true,
    hvacMode: mode,
    temperature: targetTemperature,
  };
}

function autoPlanState(state: AirconAutoState, overrides: Partial<AirconAutoState>): AirconAutoState {
  return { ...state, ...overrides };
}

function noAirconActions(state: AirconAutoState, overrides: Partial<AirconAutoState> = {}): AirconAutoPlan {
  return {
    actions: [],
    nextState: autoPlanState(state, overrides),
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
  desiredMode,
  entity,
  fanStep,
  forceRemember,
  quietSwitch,
  targetTemperature,
  turboSwitch,
}: {
  desiredMode: ActiveAirconMode;
  entity: DashboardEntity;
  fanStep: AirconFanStep;
  forceRemember: boolean;
  quietSwitch?: DashboardEntity;
  targetTemperature: number;
  turboSwitch?: DashboardEntity;
}) {
  const isOn = isClimateEntityOn(entity);
  const remember = activeAutoRemember(targetTemperature, desiredMode, fanStep);
  const actions: EntityActionInput[] = [];

  if (!isOn) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "turn_on",
    });
  }

  const modeNeedsChange = entity.state !== desiredMode || forceRemember;
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
    return noAirconActions(currentState);
  }

  const targetTemperature = preferences?.temperature ?? climateTargetTemperature(entity);
  if (targetTemperature === null || !Number.isFinite(targetTemperature)) {
    return noAirconActions(currentState, { lastTargetTemperature: null });
  }

  const selectedMode = isAirconMode(preferences?.hvacMode) ? preferences?.hvacMode : airconEntityMode(entity);
  const rememberInactive = (mode?: string) => inactiveAutoRemember(targetTemperature, mode);
  const withTarget = (overrides: Partial<AirconAutoState> = {}) =>
    noAirconActions(currentState, { lastTargetTemperature: targetTemperature, ...overrides });

  if (currentTemperature === null) {
    if (!forceRemember) {
      return withTarget({ lastSensorTemperature: null });
    }

    return {
      actions: [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "set_temperature",
          data: { temperature: targetTemperature },
          remember: { aircon: rememberInactive(selectedMode) },
        },
      ],
      nextState: autoPlanState(currentState, {
        lastSensorTemperature: null,
        lastTargetTemperature: targetTemperature,
      }),
    };
  }

  const lastSensorTemperature = currentTemperature;
  const sensorChanged = currentState.lastSensorTemperature !== currentTemperature;
  const targetChanged = currentState.lastTargetTemperature !== targetTemperature;
  const delta = currentTemperature - targetTemperature;
  const absDelta = Math.abs(delta);
  const isOn = isClimateEntityOn(entity);

  if (currentState.tailedOff) {
    if (!sensorChanged && !targetChanged) {
      return withTarget({ lastSensorTemperature });
    }

    if (absDelta < AIRCON_AUTO_BAND_DEGREES) {
      return withTarget({ enteredBandAt: null, lastSensorTemperature, tailedOff: true });
    }
  }

  if (absDelta >= AIRCON_AUTO_BAND_DEGREES) {
    const desiredMode = desiredModeForDelta(delta);
    if (!airconSupportsHvacMode(entity, desiredMode)) {
      const actions: EntityActionInput[] = [];
      if (isOn || forceRemember) {
        actions.push({
          entityId: entity.entity_id,
          domain: "climate",
          service: "turn_off",
          remember: { aircon: rememberInactive() },
        });
      }

      return {
        actions,
        nextState: autoPlanState(currentState, {
          enteredBandAt: null,
          lastSensorTemperature,
          lastTargetTemperature: targetTemperature,
          tailedOff: false,
        }),
      };
    }

    const fanStep = airconFanStepForTemperatureDelta(delta);
    return {
      actions: activeAutoActions({
        desiredMode,
        entity,
        fanStep,
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      nextState: autoPlanState(currentState, {
        enteredBandAt: null,
        lastSensorTemperature,
        lastTargetTemperature: targetTemperature,
        tailedOff: false,
      }),
    };
  }

  if (!isOn) {
    const actions: EntityActionInput[] = [];
    if (forceRemember) {
      actions.push({
        entityId: entity.entity_id,
        domain: "climate",
        service: "turn_off",
        remember: { aircon: rememberInactive() },
      });
    }

    return {
      actions,
      nextState: autoPlanState(currentState, {
        enteredBandAt: null,
        lastSensorTemperature,
        lastTargetTemperature: targetTemperature,
        tailedOff: true,
      }),
    };
  }

  const enteredAt = currentState.enteredBandAt ?? now;
  if (now - enteredAt >= AIRCON_AUTO_TAIL_MS) {
    return {
      actions: [
        {
          entityId: entity.entity_id,
          domain: "climate",
          service: "turn_off",
          remember: { aircon: rememberInactive() },
        },
      ],
      nextState: autoPlanState(currentState, {
        enteredBandAt: null,
        lastSensorTemperature,
        lastTargetTemperature: targetTemperature,
        tailedOff: true,
      }),
    };
  }

  return {
    actions: [],
    nextState: autoPlanState(currentState, {
      enteredBandAt: enteredAt,
      lastSensorTemperature,
      lastTargetTemperature: targetTemperature,
      tailedOff: false,
    }),
  };
}

export function buildAirconAutoActions(args: Omit<AirconAutoPlanInput, "state" | "now">) {
  return planAirconAutoTick(args).actions;
}

export class AirconAutoThermostat {
  private state = createInitialAirconAutoState();

  reset() {
    this.state = createInitialAirconAutoState();
  }

  snapshot() {
    return { ...this.state };
  }

  plan(args: Omit<AirconAutoPlanInput, "state">) {
    const plan = planAirconAutoTick({ ...args, state: this.state });
    this.state = plan.nextState;
    return plan;
  }
}
