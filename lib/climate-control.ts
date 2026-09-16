import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AirconAutoThermostat,
  AIRCON_SENSOR_SETTLE_MS,
  AIRCON_SENSOR_RESOLUTION_DEGREES,
  AIRCON_SENSOR_TIME_CONSTANT_MS,
  AIRCON_USER_REQUEST_MAX_AGE_MS,
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  dashboardAirconEntity,
  isClimateEntityOn,
  type EntityActionInput,
} from "./aircon-control";
import {
  BedroomHeaterThermostat,
  bedroomHeaterMode,
  bedroomHeaterSleepTimerExpired,
  roomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
} from "./bedroom-heater-control";
import { readDashboardConfig, readDashboardConfigSync } from "./dashboard-config";
import { airconDrySupport, firstState, freshSensorValue, planDryEmulationTick } from "./aircon-dry";
import {
  airconInstances,
  heaterInstances,
  type AirconInstance,
  type ClimateInstance,
  type HeaterInstance,
} from "./climate-instances";
import {
  airconPreferencesFor,
  airconPreferencesPatch,
  heaterPreferencesFor,
  heaterPreferencesPatch,
} from "./climate-preferences";
import { callService, haRest } from "./ha/client";
import { emitModuleEvent } from "./modules/runtime/hooks";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import type {
  AirconPreferences,
  BedroomHeaterPreferences,
  ClimateControlRoomState,
  ClimateControlState,
  DashboardEntity,
  DashboardPreferences,
  HaDomain,
  HaState,
} from "./types";
import {
  actuatorChangeIsExternal,
  climateActionReclaimsOwnership,
  planManualAirconTick,
  poweredActuatorRecoveryIsExternal,
} from "./climate-control-policy";

const STATE_PATH = process.env.NOVA_CLIMATE_CONTROL_STATE ?? path.join(process.cwd(), "data", "climate-control.json");
const POLL_MS = 5_000;
const COMMAND_SETTLE_MS = 12_000;
const AIRCON_SAME_DIRECTION_RESUME_DRIFT_C = 1;
const AIRCON_MIN_OFF_MS = 10 * 60_000;
const AIRCON_START_WINDOW_MS = 60 * 60_000;

/**
 * A configured climate instance's id (see lib/climate-instances.ts). This was
 * the union "lounge" | "bedroom" — two rooms of one house, which also meant the
 * control loop could never drive a third device.
 */
type RoomId = string;
type Direction = "heat" | "cool" | "dry" | "fan_only";

type PersistedRoom = {
  owner: "nova" | "external";
  observedSignature: string | null;
  commandSettleUntil: number;
  actuatorWasAvailable: boolean | null;
  overrideReason: string | null;
  lastStopReason: string | null;
  lastTransitionAt: number | null;
  settlingFromTemperature: number | null;
  sensorPendingSinceAt: number | null;
  recentStartsAt: number[];
  manualDirection: Direction | null;
  /** Change detector and latch for a Manual target the owner moved. */
  manualTargetTemperature: number | null;
  manualUserRequestAt: number | null;
  /** Emulated Dry (specs/aircon-auto-control.md): owner request not yet served. */
  dryUserRequestAt: number | null;
  /** Emulation itself switched the unit off, so it may start it again. */
  dryOffByEmulation: boolean;
  /** Emulation changed the setpoint; restore the owner's target on leaving Dry. */
  drySetpointChanged: boolean;
};

type PersistedState = {
  version: 1;
  /** Keyed by climate instance id. */
  rooms: Record<string, PersistedRoom>;
};

type PersistedSnapshot = PersistedState & { publicState?: ClimateControlState };

function defaultRoom(): PersistedRoom {
  return {
    owner: "nova",
    observedSignature: null,
    commandSettleUntil: 0,
    actuatorWasAvailable: null,
    overrideReason: null,
    lastStopReason: null,
    lastTransitionAt: null,
    settlingFromTemperature: null,
    sensorPendingSinceAt: null,
    recentStartsAt: [],
    manualDirection: null,
    manualTargetTemperature: null,
    manualUserRequestAt: null,
    dryUserRequestAt: null,
    dryOffByEmulation: false,
    drySetpointChanged: false,
  };
}

const emptyPublicRoom = (): ClimateControlRoomState => ({
  owner: "nova",
  mode: "off",
  phase: "off",
  direction: null,
  sensorAvailable: false,
  sensorReportedAt: null,
  sensorGraceEndsAt: null,
  actuatorAvailable: false,
  overrideReason: null,
  lastStopReason: null,
  pendingUserRequestAt: null,
});

type ClimateControlRuntime = {
  persisted: PersistedState;
  loaded: boolean;
  writeQueue: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  /**
   * One thermostat per instance. Each carries its own cycle state (last
   * transition, sensor-pending clock), so sharing one across devices would let
   * a second unit inherit the first's timings — which for a heater means a
   * min-cycle guard measured against the wrong device.
   */
  airconThermostats: Map<string, AirconAutoThermostat>;
  heaterThermostats: Map<string, BedroomHeaterThermostat>;
  /** Per-instance median filter over the unit's own temperature readings. */
  samples: Map<string, number[]>;
  publicState: ClimateControlState;
};

const climateGlobal = globalThis as typeof globalThis & {
  __novaClimateControlRuntime?: ClimateControlRuntime;
};
const runtime: ClimateControlRuntime = climateGlobal.__novaClimateControlRuntime ??= {
  persisted: { version: 1, rooms: {} },
  loaded: false,
  writeQueue: Promise.resolve(),
  timer: null,
  running: false,
  airconThermostats: new Map(),
  heaterThermostats: new Map(),
  samples: new Map(),
  publicState: {},
};
const persisted = runtime.persisted;

/** This instance's control state, created on first use. */
function roomState(id: RoomId): PersistedRoom {
  return (persisted.rooms[id] ??= defaultRoom());
}

function airconThermostatFor(id: RoomId) {
  let thermostat = runtime.airconThermostats.get(id);
  if (!thermostat) {
    thermostat = new AirconAutoThermostat();
    runtime.airconThermostats.set(id, thermostat);
  }
  return thermostat;
}

function heaterThermostatFor(id: RoomId) {
  let thermostat = runtime.heaterThermostats.get(id);
  if (!thermostat) {
    thermostat = new BedroomHeaterThermostat();
    runtime.heaterThermostats.set(id, thermostat);
  }
  return thermostat;
}

function samplesFor(id: RoomId) {
  let buffer = runtime.samples.get(id);
  if (!buffer) {
    buffer = [];
    runtime.samples.set(id, buffer);
  }
  return buffer;
}

function rawAsDashboardEntity(state: HaState): DashboardEntity {
  const domain = state.entity_id.split(".", 1)[0] as HaDomain;
  return {
    ...state,
    domain,
    name: String(state.attributes.friendly_name ?? state.entity_id),
    area_id: "climate",
  };
}

function stateReportTime(state?: HaState) {
  const sourceReportedAt = state?.attributes.source_reported_at;
  return typeof sourceReportedAt === "string" && sourceReportedAt
    ? sourceReportedAt
    : state?.last_reported ?? state?.last_updated ?? state?.last_changed ?? null;
}

function usable(state?: HaState) {
  return Boolean(state && !["unknown", "unavailable"].includes(state.state));
}

function findNamedSwitch(states: HaState[], tokens: string[]) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("switch.")) return false;
    const text = `${state.entity_id} ${String(state.attributes.friendly_name ?? "")}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

/**
 * The watchdog and the command path must resolve the SAME climate entity: a
 * signature computed from a different device than Auto is driving would make
 * the safety monitor watch the wrong thing. Both therefore go through here with
 * the same instance.
 */
function airconSignature(states: HaState[], unit: AirconInstance) {
  const aircon = airconEntityFor(states, unit);
  if (!aircon || ["unknown", "unavailable"].includes((aircon as HaState).state)) return null;
  const quiet = findNamedSwitch(states, ["quiet"]);
  const turbo = findNamedSwitch(states, ["turbo"]);
  return JSON.stringify({
    power: aircon.state,
    target: Number(aircon.attributes.temperature ?? null),
    fan: aircon.attributes.fan_mode ?? null,
    swing: aircon.attributes.swing_mode ?? null,
    quiet: quiet?.state ?? null,
    turbo: turbo?.state ?? null,
  });
}

function heaterSignature(switchState?: HaState) {
  return switchState && !["unknown", "unavailable"].includes(switchState.state)
    ? JSON.stringify({ power: switchState.state })
    : null;
}

/**
 * This unit's climate entity: bound explicitly when the home says which one,
 * otherwise matched by name. Explicit binding is what makes more than one air
 * conditioner possible, since name matching alone cannot tell two apart.
 */
function airconEntityFor(states: HaState[], unit: AirconInstance) {
  if (unit.entityId) {
    return states.find((state) => state.entity_id === unit.entityId);
  }
  return dashboardAirconEntity(states, unit.matchTokens) as HaState | undefined;
}

/** Both room sensors configured: Dry can be emulated on a unit without it. */
function airconRoomHasDrySensors(unit: AirconInstance) {
  return (unit.humidityEntityIds ?? []).some((id) => id.trim()) && (unit.temperatureEntityIds ?? []).some((id) => id.trim());
}

function airconSupportedModes(aircon: DashboardEntity | undefined) {
  const modes = aircon?.attributes?.hvac_modes;
  return Array.isArray(modes) ? modes.map(String) : [];
}

function emulatesDry(unit: AirconInstance, aircon: HaState | DashboardEntity | undefined) {
  return airconDrySupport(airconSupportedModes(aircon as DashboardEntity | undefined), airconRoomHasDrySensors(unit)) === "emulated";
}

/** Owner asked for Dry on a unit Nova emulates it for. */
async function requestEmulatedDry(unit: AirconInstance, now: number) {
  const room = roomState(unit.id);
  room.manualDirection = "dry";
  room.dryUserRequestAt = now;
  room.dryOffByEmulation = false;
  airconThermostatFor(unit.id).resetForUserRequest();
  await mergeDashboardPreferences(airconPreferencesPatch(unit.id, { autoMode: false, hvacMode: "dry" }));
}

/**
 * Leaving emulated Dry, however it happens: forget its bookkeeping and put back
 * the owner's target, which emulation replaced with room minus one.
 */
async function leaveEmulatedDry(unit: AirconInstance, entityId: string | undefined, preferences?: DashboardPreferences) {
  const room = roomState(unit.id);
  const restore = room.drySetpointChanged;
  room.dryUserRequestAt = null;
  room.dryOffByEmulation = false;
  room.drySetpointChanged = false;
  if (!restore || !entityId) return;
  const target = airconPreferencesFor(preferences ?? await readDashboardPreferences(), unit.id)?.temperature;
  if (typeof target === "number" && Number.isFinite(target)) {
    await executeActions(unit, [{ entityId, domain: "climate", service: "set_temperature", data: { temperature: target } }], true);
  }
}

function heaterEntityFor(states: HaState[], instance: HeaterInstance) {
  return instance.switchEntityIds.map((id) => states.find((state) => state.entity_id === id)).find(Boolean);
}

function heaterSensorFor(states: HaState[], instance: HeaterInstance) {
  return roomTemperatureEntityIds(instance.temperatureEntityIds)
    .map((id) => states.find((state) => state.entity_id === id))
    .find(Boolean);
}

async function loadPersisted() {
  if (runtime.loaded) return;
  runtime.loaded = true;
  try {
    const value = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<PersistedSnapshot> &
      Record<string, unknown>;

    // Files written before instances existed keep each room at the top level.
    // Carry those across rather than starting fresh: this state holds whether
    // Nova or a person currently owns the device, and losing it mid-heat would
    // hand a running element back to an automation the user had overridden.
    const legacyRooms: Record<string, PersistedRoom> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "version" || key === "rooms" || key === "publicState") continue;
      if (entry && typeof entry === "object" && "owner" in (entry as object)) {
        legacyRooms[key] = { ...defaultRoom(), ...(entry as PersistedRoom) };
      }
    }

    const stored = (value.rooms ?? {}) as Record<string, PersistedRoom>;
    persisted.version = 1;
    persisted.rooms = { ...legacyRooms };
    for (const [id, entry] of Object.entries(stored)) {
      persisted.rooms[id] = { ...defaultRoom(), ...entry };
    }

    if (value.publicState && Object.keys(value.publicState).length) {
      runtime.publicState = value.publicState;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function persistSoon() {
  const snapshot = JSON.stringify({ ...persisted, publicState: runtime.publicState }, null, 2) + "\n";
  runtime.writeQueue = runtime.writeQueue.then(async () => {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.${process.pid}.tmp`;
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, STATE_PATH);
  });
  return runtime.writeQueue;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function noteSample(samples: number[], value: number | null) {
  if (value === null || !Number.isFinite(value)) return;
  samples.push(value);
  while (samples.length > 5) samples.shift();
}

function pruneStarts(room: PersistedRoom, now: number) {
  room.recentStartsAt = room.recentStartsAt.filter((at) => now - at < AIRCON_START_WINDOW_MS);
}

function setExternal(instance: ClimateInstance, reason: string) {
  const room = instance.id;
  const state = roomState(room);
  state.owner = "external";
  state.overrideReason = reason;
  state.commandSettleUntil = 0;
  if (instance.kind === "aircon") airconThermostatFor(room).resetForUserRequest();
  else heaterThermostatFor(room).resetForUserRequest();
  console.warn(`[climate-control] ${room} external override; Nova automation suspended`);
}

function observeExternalChanges(instance: ClimateInstance, signature: string | null, now: number) {
  const room = instance.id;
  const state = roomState(room);
  if (signature === null) return;
  if (state.observedSignature === null) {
    state.observedSignature = signature;
    return;
  }
  if (signature === state.observedSignature) return;
  if (!actuatorChangeIsExternal({
    previousSignature: state.observedSignature,
    currentSignature: signature,
    commandSettleUntil: state.commandSettleUntil,
    now,
  })) {
    state.observedSignature = signature;
    return;
  }
  if (state.owner === "nova") setExternal(instance, "device-override");
  state.observedSignature = signature;
}

function observeActuator(instance: ClimateInstance, signature: string | null, now: number) {
  const state = roomState(instance.id);
  const available = signature !== null;
  const recoveredPowered = poweredActuatorRecoveryIsExternal({
    wasAvailable: state.actuatorWasAvailable,
    currentSignature: signature,
    commandSettleUntil: state.commandSettleUntil,
    now,
  });
  state.actuatorWasAvailable = available;
  if (recoveredPowered && state.owner === "nova" && signature) {
    setExternal(instance, "device-reconnected-on");
    state.observedSignature = signature;
    return;
  }
  observeExternalChanges(instance, signature, now);
}

async function statesAndDevices() {
  const config = await readDashboardConfig();
  const states = await haRest<HaState[]>("/api/states");
  const quietRaw = findNamedSwitch(states, ["quiet"]);
  const turboRaw = findNamedSwitch(states, ["turbo"]);
  const quiet = quietRaw ? rawAsDashboardEntity(quietRaw) : undefined;
  const turbo = turboRaw ? rawAsDashboardEntity(turboRaw) : undefined;
  return { config, states, quiet, turbo };
}

/**
 * The signature this instance is watched by. Which fields matter depends on the
 * device kind, not on which room it is in.
 */
function signatureFor(instance: ClimateInstance, states: HaState[], entityId?: string) {
  return instance.kind === "aircon"
    ? airconSignature(states, instance)
    : heaterSignature(states.find((state) => state.entity_id === entityId));
}

async function executeActions(
  instance: ClimateInstance,
  actions: EntityActionInput[],
  allowWhileExternal = false,
) {
  const room = instance.id;
  if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
  for (const action of actions) {
    if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
    const before = await haRest<HaState[]>("/api/states");
    observeActuator(instance, signatureFor(instance, before, action.entityId), Date.now());
    if (roomState(room).owner !== "nova" && !allowWhileExternal) return;
    roomState(room).commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
    const result = await callService(action.domain, action.service, {
      entity_id: action.entityId,
      ...(action.data ?? {}),
    });
    if (action.remember) await mergeDashboardPreferences(action.remember);
    const resultStates = result.length ? result : await haRest<HaState[]>("/api/states");
    const afterSignature = signatureFor(instance, resultStates, action.entityId);
    if (afterSignature) roomState(room).observedSignature = afterSignature;
  }
  await persistSoon();
}

async function stopAndCancel(instance: ClimateInstance, entityId: string, reason: string) {
  const now = Date.now();
  const room = instance.id;
  roomState(room).lastStopReason = reason;
  roomState(room).lastTransitionAt = now;
  roomState(room).sensorPendingSinceAt = null;
  roomState(room).settlingFromTemperature = null;
  if (instance.kind === "aircon") {
    airconThermostatFor(room).resetForUserRequest();
    roomState(room).manualDirection = null;
    await executeActions(instance, [{ entityId, domain: "climate", service: "turn_off" }]);
    await leaveEmulatedDry(instance, entityId);
    await mergeDashboardPreferences(airconPreferencesPatch(room, { autoMode: false, offTimerEndsAt: null }));
  } else {
    heaterThermostatFor(room).resetForUserRequest();
    await executeActions(instance, [{ entityId, domain: "switch", service: "turn_off" }]);
    await mergeDashboardPreferences(heaterPreferencesPatch(room, { mode: "off", offTimerEndsAt: null }));
  }
}

function publicRoom(args: Partial<ClimateControlRoomState> & Pick<ClimateControlRoomState, "mode" | "phase">): ClimateControlRoomState {
  return { ...emptyPublicRoom(), ...args };
}

/** What driving one instance produced, for building its public state after. */
type AirconTickResult = {
  unit: AirconInstance;
  aircon?: DashboardEntity;
  mode: "auto" | "manual" | "off";
  direction: Direction | null;
  external: boolean;
  rawTemperature: number | null;
  /**
   * Set when stopAndCancel ran this tick. The `states`/`aircon` snapshot and
   * the `mode` computed above it were both read before that call, so they
   * still describe the pre-stop unit — reporting them as this tick's public
   * state would show a driving/auto unit for a beat after Nova just forced it
   * off (a real HA turn_off plus autoMode:false), which reads as a soft,
   * internal-only stop rather than the state actually changing. The caller
   * uses this to report "off" immediately instead of waiting for the next
   * tick's fresh HA states to catch up.
   */
  forcedOff: boolean;
};

type HeaterTickResult = {
  instance: HeaterInstance;
  heater?: HaState;
  sensor?: HaState;
  mode: ReturnType<typeof bedroomHeaterMode>;
  sensorAvailable: boolean;
};

async function driveAircon(
  unit: AirconInstance,
  states: HaState[],
  quiet: DashboardEntity | undefined,
  turbo: DashboardEntity | undefined,
  preferences: DashboardPreferences,
  now: number,
): Promise<AirconTickResult> {
  const room = roomState(unit.id);
  const raw = airconEntityFor(states, unit);
  const aircon = raw ? rawAsDashboardEntity(raw) : undefined;
  const prefs = airconPreferencesFor(preferences, unit.id);
  const thermostat = airconThermostatFor(unit.id);
  const samples = samplesFor(unit.id);

  observeActuator(unit, airconSignature(states, unit), now);

  const rawTemperature = airconAutoMeasuredTemperature(aircon, now);
  noteSample(samples, rawTemperature);
  const filteredTemperature = median(samples);
  const mode = prefs?.autoMode
    ? "auto"
    : room.manualDirection
    ? "manual"
    : aircon && isClimateEntityOn(aircon)
    ? "manual"
    : "off";
  const direction = mode === "manual" && room.manualDirection
    ? room.manualDirection
    : aircon && ["heat", "cool", "dry", "fan_only"].includes(aircon.state)
    ? (aircon.state as Direction)
    : (prefs?.hvacMode as Direction | undefined) ?? null;
  const external = room.owner === "external";
  let forcedOff = false;

  if (aircon && usable(aircon) && !external) {
    const offTimer = prefs?.offTimerEndsAt;
    if (typeof offTimer === "string" && new Date(offTimer).getTime() <= now) {
      await stopAndCancel(unit, aircon.entity_id, "timer-expired");
      forcedOff = true;
    } else if (prefs?.autoMode) {
      thermostat.reconcile({
        ...airconAutoCycleStateFromPreferences(prefs),
        sensorPendingSinceAt: room.sensorPendingSinceAt,
      });
      const measured = isClimateEntityOn(aircon) ? rawTemperature : filteredTemperature;
      const plan = thermostat.plan({
        currentTemperature: measured,
        entity: aircon,
        preferences: prefs,
        quietSwitch: quiet,
        turboSwitch: turbo,
      });
      room.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
      if (plan.reason === "sensor-fail-safe-off") {
        await stopAndCancel(unit, aircon.entity_id, "sensor-timeout");
        forcedOff = true;
      } else {
        await executeActions(unit, plan.actions);
        if (plan.reason === "reached-target") room.lastStopReason = "target-reached";
      }
    } else if (
      mode === "manual" &&
      direction === "dry" &&
      emulatesDry(unit, aircon)
    ) {
      // specs/aircon-auto-control.md, "Dry emulation".
      const minTemperature = Number(aircon.attributes.min_temp);
      const decision = planDryEmulationTick({
        humidityPct: freshSensorValue(firstState(states, unit.humidityEntityIds), now),
        roomTemperatureC: freshSensorValue(firstState(states, unit.temperatureEntityIds), now),
        targetHumidityPct: unit.dryTargetHumidityPct ?? 55,
        entityState: aircon.state,
        supportedModes: airconSupportedModes(aircon),
        fanModes: Array.isArray(aircon.attributes.fan_modes) ? aircon.attributes.fan_modes.map(String) : [],
        minTemperatureC: Number.isFinite(minTemperature) ? minTemperature : 16,
        now,
        lastTransitionAt: room.lastTransitionAt,
        minDwellMs: AIRCON_MIN_OFF_MS,
        mayStartFromOff: typeof room.dryUserRequestAt === "number" || room.dryOffByEmulation,
      });
      if (decision.kind !== "hold") {
        room.dryUserRequestAt = null;
        room.dryOffByEmulation = decision.kind === "off";
      }
      if (decision.kind === "cool") {
        room.lastTransitionAt = now;
        room.recentStartsAt.push(now);
        room.drySetpointChanged = true;
        await executeActions(unit, [
          { entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: "cool" } },
          { entityId: aircon.entity_id, domain: "climate", service: "set_temperature", data: { temperature: decision.setpointC } },
          ...(decision.fanMode
            ? [{ entityId: aircon.entity_id, domain: "climate" as const, service: "set_fan_mode", data: { fan_mode: decision.fanMode } }]
            : []),
        ]);
      } else if (decision.kind === "fan_only" || decision.kind === "off") {
        if (aircon.state === "cool") room.lastTransitionAt = now;
        room.lastStopReason = "target-reached";
        await executeActions(unit, [decision.kind === "off"
          ? { entityId: aircon.entity_id, domain: "climate", service: "turn_off" }
          : { entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: "fan_only" } }]);
      }
    } else if (mode === "manual" && (direction === "heat" || direction === "cool")) {
      const target = prefs?.temperature ?? Number(aircon.attributes.temperature);
      pruneStarts(room, now);
      // Latch a target the owner moved, exactly as Auto does. Read as a number
      // rather than against null so a state file written before this field
      // existed does not read as a change on the first tick after a deploy.
      if (Number.isFinite(target)) {
        if (typeof room.manualTargetTemperature === "number" && room.manualTargetTemperature !== target) {
          room.manualUserRequestAt = now;
        }
        room.manualTargetTemperature = target;
      }
      if (
        typeof room.manualUserRequestAt === "number" &&
        now - room.manualUserRequestAt >= AIRCON_USER_REQUEST_MAX_AGE_MS
      ) {
        room.manualUserRequestAt = null;
      }
      const userRequested = typeof room.manualUserRequestAt === "number";
      const decision = Number.isFinite(target)
        ? planManualAirconTick({
            direction,
            isOn: isClimateEntityOn(aircon),
            userRequested,
            rawTemperature,
            filteredTemperature,
            targetTemperature: target,
            now,
            lastTransitionAt: room.lastTransitionAt,
            settlingFromTemperature: room.settlingFromTemperature,
            minOffMs: AIRCON_MIN_OFF_MS,
            sensorSettleMs: AIRCON_SENSOR_SETTLE_MS,
            sensorResolutionC: AIRCON_SENSOR_RESOLUTION_DEGREES,
            sensorTimeConstantMs: AIRCON_SENSOR_TIME_CONSTANT_MS,
            resumeDriftC: AIRCON_SAME_DIRECTION_RESUME_DRIFT_C,
          })
        : "hold";
      // Every outcome above is an answer once a request is latched — driving
      // already, started now, or the target is met — so none of them defer it.
      if (userRequested) room.manualUserRequestAt = null;
      if (decision === "stop") {
        room.lastTransitionAt = now;
        room.settlingFromTemperature = rawTemperature;
        room.lastStopReason = "target-reached";
        await executeActions(unit, [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
        forcedOff = true;
      } else if (decision === "start") {
        room.lastTransitionAt = now;
        room.settlingFromTemperature = null;
        room.recentStartsAt.push(now);
        await executeActions(unit, [{
          entityId: aircon.entity_id,
          domain: "climate",
          service: "set_hvac_mode",
          data: { hvac_mode: direction },
        }]);
      }
    }
  }

  return { unit, aircon, mode, direction, external, rawTemperature, forcedOff };
}

async function driveHeater(
  instance: HeaterInstance,
  states: HaState[],
  preferences: DashboardPreferences,
  now: number,
): Promise<HeaterTickResult> {
  const room = roomState(instance.id);
  const heater = heaterEntityFor(states, instance);
  const sensor = heaterSensorFor(states, instance);
  const thermostat = heaterThermostatFor(instance.id);

  observeActuator(instance, heaterSignature(heater), now);

  const prefs = heaterPreferencesFor(preferences, instance.id);
  const mode = bedroomHeaterMode(prefs);
  const temperature = Number(bedroomTemperatureStateIsFresh(sensor, now) ? sensor?.state : Number.NaN);
  const sensorAvailable = Number.isFinite(temperature);

  if (heater && usable(heater) && room.owner === "nova") {
    if (bedroomHeaterSleepTimerExpired(prefs, now)) {
      await stopAndCancel(instance, heater.entity_id, "timer-expired");
    } else if (mode === "off" && heater.state === "on") {
      room.lastStopReason = "nova-off";
      await executeActions(instance, [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
    } else if (mode === "auto") {
      thermostat.reconcile({
        lastTransitionAt: room.lastTransitionAt,
        sensorPendingSinceAt: room.sensorPendingSinceAt,
      });
      const plan = thermostat.plan({
        currentTemperature: sensorAvailable ? temperature : null,
        entityId: heater.entity_id,
        isOn: heater.state === "on",
        now,
        preferences: prefs,
      });
      room.lastTransitionAt = plan.nextState.lastTransitionAt;
      room.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
      if (plan.reason === "sensor-fail-safe-off") {
        await stopAndCancel(instance, heater.entity_id, "sensor-timeout");
      } else {
        await executeActions(instance, plan.actions);
        if (["reached-target", "above-target"].includes(plan.reason)) room.lastStopReason = "target-reached";
      }
    }
  }

  return { instance, heater, sensor, mode, sensorAvailable };
}

/**
 * A room's phase reduced to what a message would say about it. `resting` and
 * `off` both read as "off" on purpose: a thermostat cycling between holding and
 * stopped is not a state change anyone wants narrated.
 */
function reportableState(phase: string | undefined): "on" | "off" | "waiting" | undefined {
  if (phase === "driving") return "on";
  if (phase === "resting" || phase === "off") return "off";
  if (phase === "grace") return "waiting";
  return undefined;
}

const STOP_REASONS: Record<string, string> = {
  "target-reached": "the room reached its target",
  "sensor-lost": "the room sensor stopped reporting",
  "timer-expired": "its off timer expired",
};

/**
 * Publish `thermostat.transition` to installed modules when a room actually
 * changes state. This is the server-side authority path — it fires with no
 * browser open, which is the only way "heater turned off when the room reached
 * 22 degrees" is reachable at all.
 */
function emitClimateTransitions(
  previous: ClimateControlState,
  next: ClimateControlState,
  meta: Map<string, { title: string; target?: number }>,
) {
  const at = new Date().toISOString();
  for (const [roomId, room] of Object.entries(next)) {
    const before = reportableState(previous[roomId]?.phase);
    const after = reportableState(room.phase);
    if (!after || before === undefined || before === after) {
      continue;
    }
    const info = meta.get(roomId);
    emitModuleEvent({
      id: "thermostat.transition",
      at,
      source: "server",
      actor: "climate-control",
      entity: {
        id: roomId,
        friendlyName: info?.title ?? roomId,
        domain: "climate",
        state: after,
        previousState: before,
      },
      zone: { id: roomId },
      target: info?.target,
      trigger: room.owner === "external" ? "manual" : "thermostat",
      reason: after === "off" ? STOP_REASONS[room.lastStopReason ?? ""] : undefined,
      data: { mode: room.mode, phase: room.phase, direction: room.direction },
    });
  }
}

async function tick() {
  if (runtime.running) return;
  runtime.running = true;
  try {
    await loadPersisted();
    const now = Date.now();
    const { config, states, quiet, turbo } = await statesAndDevices();
    const preferences = await readDashboardPreferences();

    const airconResults: AirconTickResult[] = [];
    for (const unit of airconInstances(config)) {
      airconResults.push(await driveAircon(unit, states, quiet, turbo, preferences, now));
    }

    const heaterResults: HeaterTickResult[] = [];
    for (const instance of heaterInstances(config)) {
      heaterResults.push(await driveHeater(instance, states, preferences, now));
    }

    const latest = await readDashboardPreferences();
    const publicState: ClimateControlState = {};
    // Enough to describe a transition to a module: which device, what it is
    // aiming at. Collected as the rooms are built because the loops below are
    // the only place the instance config is in hand.
    const transitionMeta = new Map<string, { title: string; target?: number }>();

    for (const { unit, aircon, mode, direction, external, rawTemperature, forcedOff } of airconResults) {
      const room = roomState(unit.id);
      const prefs = airconPreferencesFor(latest, unit.id);
      const snapshot = airconThermostatFor(unit.id).snapshot();
      const pendingAt = snapshot.sensorPendingSinceAt;
      transitionMeta.set(unit.id, { title: unit.title, target: prefs?.temperature });
      publicState[unit.id] = publicRoom({
        owner: room.owner,
        // forcedOff means stopAndCancel just ran: the `aircon`/`mode` above were
        // read before that turn_off, so trusting them here would report the
        // pre-stop direction/auto for a beat — a real HA stop that still reads
        // as internally driving. Report the stop immediately instead.
        mode: forcedOff ? "off" : external ? (aircon && isClimateEntityOn(aircon) ? "manual" : "off") : (prefs?.autoMode ? "auto" : mode),
        phase: forcedOff ? "off" : external ? (aircon && isClimateEntityOn(aircon) ? "driving" : "off")
          : prefs?.autoMode && rawTemperature === null ? "grace"
          : aircon && isClimateEntityOn(aircon) ? "driving" : prefs?.autoMode || mode === "manual" ? "resting" : "off",
        direction,
        dryEmulatable: emulatesDry(unit, aircon),
        sensorAvailable: rawTemperature !== null,
        sensorReportedAt: stateReportTime(aircon),
        sensorGraceEndsAt: prefs?.autoMode && rawTemperature === null && typeof pendingAt === "number"
          ? new Date(pendingAt + 2 * 60_000).toISOString() : null,
        actuatorAvailable: usable(aircon),
        overrideReason: room.overrideReason,
        lastStopReason: room.lastStopReason,
        pendingUserRequestAt: snapshot.userRequestAt === null
          ? null
          : new Date(snapshot.userRequestAt).toISOString(),
      });
    }

    for (const { instance, heater, sensor, mode, sensorAvailable } of heaterResults) {
      const room = roomState(instance.id);
      const pendingAt = heaterThermostatFor(instance.id).snapshot().sensorPendingSinceAt;
      transitionMeta.set(instance.id, {
        title: instance.title,
        target: heaterPreferencesFor(latest, instance.id)?.temperature,
      });
      publicState[instance.id] = publicRoom({
        owner: room.owner,
        mode: room.owner === "external" ? (heater?.state === "on" ? "manual" : "off") : mode,
        phase: room.owner === "external" ? (heater?.state === "on" ? "driving" : "off")
          : mode === "auto" && !sensorAvailable ? "grace"
          : heater?.state === "on" ? "driving" : mode === "auto" ? "resting" : "off",
        direction: heater?.state === "on" ? "heat" : null,
        sensorAvailable,
        sensorReportedAt: stateReportTime(sensor),
        sensorGraceEndsAt: mode === "auto" && !sensorAvailable && pendingAt !== null
          ? new Date(pendingAt + 2 * 60_000).toISOString() : null,
        actuatorAvailable: usable(heater),
        overrideReason: room.overrideReason,
        lastStopReason: room.lastStopReason,
      });
    }

    emitClimateTransitions(runtime.publicState, publicState, transitionMeta);
    runtime.publicState = publicState;
    await persistSoon();
  } catch (error) {
    console.error("[climate-control] tick failed", error);
  } finally {
    runtime.running = false;
  }
}

export async function climateControlState(): Promise<ClimateControlState> {
  await loadPersisted();
  try {
    // Next can evaluate instrumentation and route chunks in different module
    // contexts. The process-global store handles duplicated chunks in one
    // context; the durable snapshot is the boundary for separate contexts.
    const snapshot = JSON.parse(await readFile(STATE_PATH, "utf8")) as PersistedSnapshot;
    if (snapshot.publicState?.lounge && snapshot.publicState?.bedroom) {
      return structuredClone(snapshot.publicState);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[climate-control] could not read public snapshot", error);
    }
  }
  return structuredClone(runtime.publicState);
}

async function instanceById(id: RoomId): Promise<ClimateInstance | undefined> {
  const config = await readDashboardConfig();
  return [...airconInstances(config), ...heaterInstances(config)].find((instance) => instance.id === id);
}

export async function claimClimateControl(room: RoomId) {
  await loadPersisted();
  const state = roomState(room);
  state.owner = "nova";
  state.overrideReason = null;
  state.commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
  const instance = await instanceById(room);
  // Reset only this instance's own thermostat; the others are mid-cycle on
  // their own devices and must not have their timings cleared.
  if (instance?.kind === "heater") heaterThermostatFor(room).resetForUserRequest();
  else airconThermostatFor(room).resetForUserRequest();
  await persistSoon();
}

export async function handleLegacyClimateAction(action: {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
}) {
  const { config, states } = await statesAndDevices();
  const units = airconInstances(config);
  const heaters = heaterInstances(config);

  // Which configured device does this entity belong to? Heaters bind by entity
  // id; an air conditioner binds by its resolved entity, or — for its companion
  // quiet/turbo switches, which are not the climate entity — by name. With more
  // than one unit the name test cannot say which, so it stays with the first,
  // matching what a single-unit home has always done.
  const heaterMatch = heaters.find((instance) => instance.switchEntityIds.includes(action.entityId));
  const unitMatch = units.find((unit) => airconEntityFor(states, unit)?.entity_id === action.entityId);
  const looksLikeAircon =
    `${action.entityId} ${String(states.find((state) => state.entity_id === action.entityId)?.attributes.friendly_name ?? "")}`
      .toLowerCase().match(/air|quiet|turbo|xtra/) !== null;
  const instance = unitMatch ?? heaterMatch ?? (looksLikeAircon ? units[0] : undefined);
  if (!instance) return false;

  const room = instance.id;
  const isAircon = instance.kind === "aircon";
  const aircon = isAircon ? airconEntityFor(states, instance) : undefined;
  const reclaims = climateActionReclaimsOwnership({
    room: isAircon ? "lounge" : "bedroom",
    service: action.service,
    autoMode: action.remember?.aircon?.autoMode,
  });
  if (reclaims) await claimClimateControl(room);
  else await loadPersisted();

  const state = roomState(room);
  if (isAircon) {
    const leavingDry = state.manualDirection === "dry" && (
      action.service === "turn_off" ||
      action.remember?.aircon?.autoMode === true ||
      (action.service === "set_hvac_mode" && action.data?.hvac_mode !== "dry")
    );
    if (action.remember?.aircon?.autoMode === true) state.manualDirection = null;
    if (action.service === "set_hvac_mode" && action.remember?.aircon?.autoMode === false) {
      const direction = action.data?.hvac_mode;
      if (direction === "heat" || direction === "cool" || direction === "dry" || direction === "fan_only") {
        state.manualDirection = direction;
      }
    }
    if (action.remember?.aircon?.autoMode === false && state.manualDirection === null) {
      const direction = aircon?.state;
      if (direction === "heat" || direction === "cool" || direction === "fan_only") {
        state.manualDirection = direction;
      }
    }
    // Every turn_off ends Manual, whoever sent it: a remembered direction
    // would otherwise let the loop start the unit again.
    if (action.service === "turn_off") {
      state.manualDirection = null;
    }
    if (leavingDry && instance.kind === "aircon") {
      await leaveEmulatedDry(instance, aircon?.entity_id);
    }
  } else if (action.service === "turn_on") {
    // Energise the switch, but leave the stored mode alone. This branch is
    // reached by ANY generic caller — a zone "everything on" control, a scene,
    // an MCP tool call — none of which know the switch is climate-managed.
    // Promoting the heater to Auto here armed the thermostat behind the
    // owner's back; arming Auto is now an explicit climate intent only (the
    // heater card, or /api/climate-control with mode "auto"). See
    // specs/bedroom-heater-control-integrity.md §5.
    heaterThermostatFor(room).resetForUserRequest();
  } else if (action.service === "turn_off") {
    await mergeDashboardPreferences(heaterPreferencesPatch(room, { mode: "off", offTimerEndsAt: null }));
  }
  if (action.remember) await mergeDashboardPreferences(action.remember);
  if (action.service === "turn_off") {
    state.lastStopReason = "dashboard-off";
  }
  if (
    instance.kind === "aircon" &&
    action.service === "set_hvac_mode" &&
    action.data?.hvac_mode === "dry" &&
    emulatesDry(instance, aircon)
  ) {
    // The unit has no dry mode; the loop emulates it (specs/aircon-auto-control.md).
    // Voice, automations and MCP send this without `remember`, so the request is
    // recorded here rather than left to the caller.
    if (!reclaims) await claimClimateControl(room);
    await requestEmulatedDry(instance, Date.now());
    await persistSoon();
    void tick();
    return true;
  }
  await executeActions(instance, [{
    entityId: action.entityId,
    domain: action.domain,
    service: action.service,
    data: action.data,
  }], !reclaims);
  void tick();
  return true;
}

export type ClimateControlIntent = {
  room: RoomId;
  mode?: "auto" | "manual" | "off";
  direction?: Direction;
  temperature?: number;
  offTimerEndsAt?: string | null;
};

export async function applyClimateControlIntent(intent: ClimateControlIntent) {
  if (intent.mode) await claimClimateControl(intent.room);
  else await loadPersisted();
  const { states } = await statesAndDevices();
  const instance = await instanceById(intent.room);
  if (!instance) return climateControlState();

  if (instance.kind === "aircon") {
    const aircon = airconEntityFor(states, instance);
    const update: AirconPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.direction ? { hvacMode: intent.direction } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.mode ? { autoMode: intent.mode === "auto" } : {}),
    };
    await mergeDashboardPreferences(airconPreferencesPatch(instance.id, update));
    const state = roomState(instance.id);
    const emulatedDry = intent.direction === "dry" && intent.mode !== "off" && intent.mode !== "auto" && emulatesDry(instance, aircon);
    const leavingDry = state.manualDirection === "dry" && !emulatedDry &&
      (intent.mode === "off" || intent.mode === "auto" || (intent.direction !== undefined && intent.direction !== "dry"));
    if (intent.mode === "off" || intent.mode === "auto") state.manualDirection = null;
    if (intent.mode === "manual" && intent.direction) state.manualDirection = intent.direction;
    if (aircon && intent.mode === "off") {
      await executeActions(instance, [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
    }
    if (leavingDry) await leaveEmulatedDry(instance, aircon?.entity_id);
    if (emulatedDry) await requestEmulatedDry(instance, Date.now());
    else if (aircon && intent.mode === "manual" && intent.direction) await executeActions(instance, [{
      entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: intent.direction },
    }]);
  } else {
    const heater = heaterEntityFor(states, instance);
    const update: BedroomHeaterPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.mode ? { mode: intent.mode === "auto" ? "auto" : "off" } : {}),
    };
    await mergeDashboardPreferences(heaterPreferencesPatch(instance.id, update));
    if (heater && intent.mode === "off") {
      await executeActions(instance, [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
    }
  }
  await tick();
  return climateControlState();
}

export async function evaluateClimateControlNow() {
  await tick();
}

export function startClimateControl() {
  if (runtime.timer) return;
  runtime.timer = setInterval(() => void tick(), POLL_MS);
  runtime.timer.unref?.();
  void tick();
  console.log("[climate-control] unified server controller started");
}

export function stopClimateControlForTest() {
  if (runtime.timer) clearInterval(runtime.timer);
  runtime.timer = null;
  runtime.running = false;
}
