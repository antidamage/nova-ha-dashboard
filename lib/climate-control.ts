import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AirconAutoThermostat,
  AIRCON_SENSOR_SETTLE_MS,
  airconAutoCycleStateFromPreferences,
  airconAutoMeasuredTemperature,
  dashboardAirconEntity,
  isClimateEntityOn,
  type EntityActionInput,
} from "./aircon-control";
import {
  BedroomHeaterThermostat,
  bedroomHeaterMode,
  bedroomHeaterScheduleEdge,
  bedroomHeaterSleepTimerExpired,
  bedroomHeaterWindow,
  bedroomRoomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
  minutesFromMidday,
} from "./bedroom-heater-control";
import { readDashboardConfig } from "./dashboard-config";
import { callService, haRest } from "./ha/client";
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

type RoomId = "lounge" | "bedroom";
type Direction = "heat" | "cool" | "fan_only";

type PersistedRoom = {
  owner: "nova" | "external";
  observedSignature: string | null;
  commandSettleUntil: number;
  actuatorWasAvailable: boolean | null;
  overrideReason: string | null;
  lastStopReason: string | null;
  lastTransitionAt: number | null;
  sensorPendingSinceAt: number | null;
  recentStartsAt: number[];
  scheduleBlocked: boolean;
  manualDirection: Direction | null;
};

type PersistedState = {
  version: 1;
  lounge: PersistedRoom;
  bedroom: PersistedRoom;
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
    sensorPendingSinceAt: null,
    recentStartsAt: [],
    scheduleBlocked: false,
    manualDirection: null,
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
});

type ClimateControlRuntime = {
  persisted: PersistedState;
  loaded: boolean;
  writeQueue: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  scheduleCursor: number | null;
  airconThermostat: AirconAutoThermostat;
  bedroomThermostat: BedroomHeaterThermostat;
  loungeSamples: number[];
  publicState: ClimateControlState;
};

const climateGlobal = globalThis as typeof globalThis & {
  __novaClimateControlRuntime?: ClimateControlRuntime;
};
const runtime = climateGlobal.__novaClimateControlRuntime ??= {
  persisted: { version: 1, lounge: defaultRoom(), bedroom: defaultRoom() },
  loaded: false,
  writeQueue: Promise.resolve(),
  timer: null,
  running: false,
  scheduleCursor: null,
  airconThermostat: new AirconAutoThermostat(),
  bedroomThermostat: new BedroomHeaterThermostat(),
  loungeSamples: [],
  publicState: { lounge: emptyPublicRoom(), bedroom: emptyPublicRoom() },
};
const persisted = runtime.persisted;
const airconThermostat = runtime.airconThermostat;
const bedroomThermostat = runtime.bedroomThermostat;
const loungeSamples = runtime.loungeSamples;

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

function loungeSignature(states: HaState[]) {
  const aircon = dashboardAirconEntity(states);
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

function bedroomSignature(switchState?: HaState) {
  return switchState && !["unknown", "unavailable"].includes(switchState.state)
    ? JSON.stringify({ power: switchState.state })
    : null;
}

async function loadPersisted() {
  if (runtime.loaded) return;
  runtime.loaded = true;
  try {
    const value = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<PersistedSnapshot>;
    Object.assign(persisted, {
      version: 1,
      lounge: { ...defaultRoom(), ...(value.lounge ?? {}) },
      bedroom: { ...defaultRoom(), ...(value.bedroom ?? {}) },
    });
    if (value.publicState?.lounge && value.publicState?.bedroom) {
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

function noteSample(value: number | null) {
  if (value === null || !Number.isFinite(value)) return;
  loungeSamples.push(value);
  while (loungeSamples.length > 5) loungeSamples.shift();
}

function pruneStarts(room: PersistedRoom, now: number) {
  room.recentStartsAt = room.recentStartsAt.filter((at) => now - at < AIRCON_START_WINDOW_MS);
}

function setExternal(room: RoomId, reason: string) {
  const state = persisted[room];
  state.owner = "external";
  state.overrideReason = reason;
  state.commandSettleUntil = 0;
  state.scheduleBlocked = room === "bedroom";
  if (room === "lounge") airconThermostat.resetForUserRequest();
  else bedroomThermostat.resetForUserRequest();
  console.warn(`[climate-control] ${room} external override; Nova automation suspended`);
}

function observeExternalChanges(room: RoomId, signature: string | null, now: number) {
  const state = persisted[room];
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
  if (state.owner === "nova") setExternal(room, "device-override");
  state.observedSignature = signature;
}

function observeActuator(room: RoomId, signature: string | null, now: number) {
  const state = persisted[room];
  const available = signature !== null;
  const recoveredPowered = poweredActuatorRecoveryIsExternal({
    wasAvailable: state.actuatorWasAvailable,
    currentSignature: signature,
    commandSettleUntil: state.commandSettleUntil,
    now,
  });
  state.actuatorWasAvailable = available;
  if (recoveredPowered && state.owner === "nova" && signature) {
    setExternal(room, "device-reconnected-on");
    state.observedSignature = signature;
    return;
  }
  observeExternalChanges(room, signature, now);
}

async function statesAndDevices() {
  const config = await readDashboardConfig();
  const states = await haRest<HaState[]>("/api/states");
  const airconRaw = dashboardAirconEntity(states);
  const aircon = airconRaw ? rawAsDashboardEntity(airconRaw as HaState) : undefined;
  const quietRaw = findNamedSwitch(states, ["quiet"]);
  const turboRaw = findNamedSwitch(states, ["turbo"]);
  const quiet = quietRaw ? rawAsDashboardEntity(quietRaw) : undefined;
  const turbo = turboRaw ? rawAsDashboardEntity(turboRaw) : undefined;
  const heaterIds = config.dashboard.bedroomHeater?.switchEntityIds ?? [];
  const heater = heaterIds.map((id) => states.find((state) => state.entity_id === id)).find(Boolean);
  const sensorIds = bedroomRoomTemperatureEntityIds(config.dashboard.bedroomHeater?.temperatureEntityIds ?? []);
  const sensor = sensorIds.map((id) => states.find((state) => state.entity_id === id)).find(Boolean);
  return { states, aircon, quiet, turbo, heater, sensor };
}

async function executeActions(room: RoomId, actions: EntityActionInput[], allowWhileExternal = false) {
  if (persisted[room].owner !== "nova" && !allowWhileExternal) return;
  for (const action of actions) {
    if (persisted[room].owner !== "nova" && !allowWhileExternal) return;
    const before = await haRest<HaState[]>("/api/states");
    const signature = room === "lounge"
      ? loungeSignature(before)
      : bedroomSignature(before.find((state) => state.entity_id === action.entityId));
    observeActuator(room, signature, Date.now());
    if (persisted[room].owner !== "nova" && !allowWhileExternal) return;
    persisted[room].commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
    const result = await callService(action.domain, action.service, {
      entity_id: action.entityId,
      ...(action.data ?? {}),
    });
    if (action.remember) await mergeDashboardPreferences(action.remember);
    const resultStates = result.length ? result : await haRest<HaState[]>("/api/states");
    const afterSignature = room === "lounge"
      ? loungeSignature(resultStates)
      : bedroomSignature(resultStates.find((state) => state.entity_id === action.entityId));
    if (afterSignature) persisted[room].observedSignature = afterSignature;
  }
  await persistSoon();
}

async function stopAndCancel(room: RoomId, entityId: string, reason: string) {
  const now = Date.now();
  persisted[room].lastStopReason = reason;
  persisted[room].lastTransitionAt = now;
  persisted[room].sensorPendingSinceAt = null;
  if (room === "lounge") {
    airconThermostat.resetForUserRequest();
    await executeActions(room, [{ entityId, domain: "climate", service: "turn_off" }]);
    await mergeDashboardPreferences({ aircon: { autoMode: false, offTimerEndsAt: null } });
  } else {
    bedroomThermostat.resetForUserRequest();
    await executeActions(room, [{ entityId, domain: "switch", service: "turn_off" }]);
    await mergeDashboardPreferences({ bedroomHeater: { mode: "off", offTimerEndsAt: null } });
  }
}

async function applyBedroomSchedule(settings: BedroomHeaterPreferences | undefined, nowDate: Date) {
  const nowMinutes = minutesFromMidday(nowDate);
  const previous = runtime.scheduleCursor;
  runtime.scheduleCursor = nowMinutes;
  if (previous === null || persisted.bedroom.scheduleBlocked) return null;
  const window = bedroomHeaterWindow(settings);
  const edge = bedroomHeaterScheduleEdge(previous, nowMinutes, window.start, window.end);
  if (!edge) return null;
  persisted.bedroom.owner = "nova";
  persisted.bedroom.overrideReason = null;
  await mergeDashboardPreferences({ bedroomHeater: { mode: edge, offTimerEndsAt: null } });
  bedroomThermostat.resetForUserRequest();
  return edge;
}

function publicRoom(args: Partial<ClimateControlRoomState> & Pick<ClimateControlRoomState, "mode" | "phase">): ClimateControlRoomState {
  return { ...emptyPublicRoom(), ...args };
}

async function tick() {
  if (runtime.running) return;
  runtime.running = true;
  try {
    await loadPersisted();
    const now = Date.now();
    const { states, aircon, quiet, turbo, heater, sensor } = await statesAndDevices();
    const preferences = await readDashboardPreferences();

    observeActuator("lounge", loungeSignature(states), now);
    observeActuator("bedroom", bedroomSignature(heater), now);

    const rawLoungeTemperature = airconAutoMeasuredTemperature(aircon, now);
    noteSample(rawLoungeTemperature);
    const filteredLoungeTemperature = median(loungeSamples);
    const loungeMode = preferences.aircon?.autoMode ? "auto" : persisted.lounge.manualDirection ? "manual" : aircon && isClimateEntityOn(aircon) ? "manual" : "off";
    const loungeDirection = loungeMode === "manual" && persisted.lounge.manualDirection
      ? persisted.lounge.manualDirection
      : aircon && ["heat", "cool", "fan_only"].includes(aircon.state)
      ? aircon.state as Direction
      : (preferences.aircon?.hvacMode as Direction | undefined) ?? null;
    const loungeExternal = persisted.lounge.owner === "external";

    if (aircon && usable(aircon) && !loungeExternal) {
      const offTimer = preferences.aircon?.offTimerEndsAt;
      if (typeof offTimer === "string" && new Date(offTimer).getTime() <= now) {
        await stopAndCancel("lounge", aircon.entity_id, "timer-expired");
      } else if (preferences.aircon?.autoMode) {
        airconThermostat.reconcile({
          ...airconAutoCycleStateFromPreferences(preferences.aircon),
          sensorPendingSinceAt: persisted.lounge.sensorPendingSinceAt,
        });
        const measured = isClimateEntityOn(aircon) ? rawLoungeTemperature : filteredLoungeTemperature;
        const plan = airconThermostat.plan({
          currentTemperature: measured,
          entity: aircon,
          preferences: preferences.aircon,
          quietSwitch: quiet,
          turboSwitch: turbo,
        });
        persisted.lounge.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
        if (plan.reason === "sensor-fail-safe-off") {
          await stopAndCancel("lounge", aircon.entity_id, "sensor-timeout");
        } else {
          await executeActions("lounge", plan.actions);
          if (plan.reason === "reached-target") persisted.lounge.lastStopReason = "target-reached";
        }
      } else if (loungeMode === "manual" && (loungeDirection === "heat" || loungeDirection === "cool")) {
        const target = preferences.aircon?.temperature ?? Number(aircon.attributes.temperature);
        pruneStarts(persisted.lounge, now);
        const decision = Number.isFinite(target) ? planManualAirconTick({
          direction: loungeDirection,
          isOn: isClimateEntityOn(aircon),
          rawTemperature: rawLoungeTemperature,
          filteredTemperature: filteredLoungeTemperature,
          targetTemperature: target,
          now,
          lastTransitionAt: persisted.lounge.lastTransitionAt,
          minOffMs: AIRCON_MIN_OFF_MS,
          sensorSettleMs: AIRCON_SENSOR_SETTLE_MS,
          resumeDriftC: AIRCON_SAME_DIRECTION_RESUME_DRIFT_C,
        }) : "hold";
        if (decision === "stop") {
          persisted.lounge.lastTransitionAt = now;
          persisted.lounge.lastStopReason = "target-reached";
          await executeActions("lounge", [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
        } else if (decision === "start") {
            persisted.lounge.lastTransitionAt = now;
            persisted.lounge.recentStartsAt.push(now);
            await executeActions("lounge", [{
              entityId: aircon.entity_id,
              domain: "climate",
              service: "set_hvac_mode",
              data: { hvac_mode: loungeDirection },
            }]);
          }
        }
      }

    const bedroomScheduleEdge = await applyBedroomSchedule(preferences.bedroomHeater, new Date(now));
    const bedroomPreferences = (await readDashboardPreferences()).bedroomHeater;
    const bedroomMode = bedroomHeaterMode(bedroomPreferences);
    const bedroomTemperature = Number(
      bedroomTemperatureStateIsFresh(sensor, now) ? sensor?.state : Number.NaN,
    );
    const bedroomSensorAvailable = Number.isFinite(bedroomTemperature);
    if (heater && usable(heater) && persisted.bedroom.owner === "nova") {
      if (bedroomScheduleEdge === "off") {
        await stopAndCancel("bedroom", heater.entity_id, "schedule-ended");
      } else if (bedroomHeaterSleepTimerExpired(bedroomPreferences, now)) {
        await stopAndCancel("bedroom", heater.entity_id, "timer-expired");
      } else if (bedroomMode === "off" && heater.state === "on") {
        persisted.bedroom.lastStopReason = "nova-off";
        await executeActions("bedroom", [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
      } else if (bedroomMode === "auto") {
        bedroomThermostat.reconcile({
          lastTransitionAt: persisted.bedroom.lastTransitionAt,
          sensorPendingSinceAt: persisted.bedroom.sensorPendingSinceAt,
        });
        const plan = bedroomThermostat.plan({
          currentTemperature: bedroomSensorAvailable ? bedroomTemperature : null,
          entityId: heater.entity_id,
          isOn: heater.state === "on",
          now,
          preferences: bedroomPreferences,
        });
        persisted.bedroom.lastTransitionAt = plan.nextState.lastTransitionAt;
        persisted.bedroom.sensorPendingSinceAt = plan.nextState.sensorPendingSinceAt;
        if (plan.reason === "sensor-fail-safe-off") {
          await stopAndCancel("bedroom", heater.entity_id, "sensor-timeout");
        } else {
          await executeActions("bedroom", plan.actions);
          if (["reached-target", "above-target"].includes(plan.reason)) persisted.bedroom.lastStopReason = "target-reached";
        }
      }
    }

    const latest = await readDashboardPreferences();
    const loungeSensorPendingAt = airconThermostat.snapshot().sensorPendingSinceAt;
    const bedroomSensorPendingAt = bedroomThermostat.snapshot().sensorPendingSinceAt;
    runtime.publicState = {
      lounge: publicRoom({
        owner: persisted.lounge.owner,
        mode: loungeExternal ? (aircon && isClimateEntityOn(aircon) ? "manual" : "off") : (latest.aircon?.autoMode ? "auto" : loungeMode),
        phase: loungeExternal ? (aircon && isClimateEntityOn(aircon) ? "driving" : "off")
          : latest.aircon?.autoMode && rawLoungeTemperature === null ? "grace"
          : aircon && isClimateEntityOn(aircon) ? "driving" : latest.aircon?.autoMode || loungeMode === "manual" ? "resting" : "off",
        direction: loungeDirection,
        sensorAvailable: rawLoungeTemperature !== null,
        sensorReportedAt: stateReportTime(aircon),
        sensorGraceEndsAt: latest.aircon?.autoMode && rawLoungeTemperature === null && typeof loungeSensorPendingAt === "number"
          ? new Date(loungeSensorPendingAt + 2 * 60_000).toISOString() : null,
        actuatorAvailable: usable(aircon),
        overrideReason: persisted.lounge.overrideReason,
        lastStopReason: persisted.lounge.lastStopReason,
      }),
      bedroom: publicRoom({
        owner: persisted.bedroom.owner,
        mode: persisted.bedroom.owner === "external" ? (heater?.state === "on" ? "manual" : "off") : bedroomMode,
        phase: persisted.bedroom.owner === "external" ? (heater?.state === "on" ? "driving" : "off")
          : bedroomMode === "auto" && !bedroomSensorAvailable ? "grace"
          : heater?.state === "on" ? "driving" : bedroomMode === "auto" ? "resting" : "off",
        direction: heater?.state === "on" ? "heat" : null,
        sensorAvailable: bedroomSensorAvailable,
        sensorReportedAt: stateReportTime(sensor),
        sensorGraceEndsAt: bedroomMode === "auto" && !bedroomSensorAvailable && bedroomSensorPendingAt !== null
          ? new Date(bedroomSensorPendingAt + 2 * 60_000).toISOString() : null,
        actuatorAvailable: usable(heater),
        overrideReason: persisted.bedroom.overrideReason,
        lastStopReason: persisted.bedroom.lastStopReason,
      }),
    };
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

export async function claimClimateControl(room: RoomId) {
  await loadPersisted();
  persisted[room].owner = "nova";
  persisted[room].overrideReason = null;
  persisted[room].scheduleBlocked = false;
  persisted[room].commandSettleUntil = Date.now() + COMMAND_SETTLE_MS;
  if (room === "lounge") airconThermostat.resetForUserRequest();
  else bedroomThermostat.resetForUserRequest();
  await persistSoon();
}

export async function handleLegacyClimateAction(action: {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
}) {
  const { states, aircon, heater } = await statesAndDevices();
  const loungeRelated = action.entityId === aircon?.entity_id ||
    `${action.entityId} ${String(states.find((state) => state.entity_id === action.entityId)?.attributes.friendly_name ?? "")}`
      .toLowerCase().match(/air|gree|quiet|turbo|xtra/) !== null;
  const bedroomRelated = action.entityId === heater?.entity_id;
  if (!loungeRelated && !bedroomRelated) return false;
  const room: RoomId = loungeRelated ? "lounge" : "bedroom";
  const reclaims = climateActionReclaimsOwnership({
    room,
    service: action.service,
    autoMode: action.remember?.aircon?.autoMode,
  });
  if (reclaims) await claimClimateControl(room);
  else await loadPersisted();
  if (room === "lounge") {
    if (action.remember?.aircon?.autoMode === true) persisted.lounge.manualDirection = null;
    if (action.service === "set_hvac_mode" && action.remember?.aircon?.autoMode === false) {
      const direction = action.data?.hvac_mode;
      if (direction === "heat" || direction === "cool" || direction === "fan_only") {
        persisted.lounge.manualDirection = direction;
      }
    }
    if (action.remember?.aircon?.autoMode === false && persisted.lounge.manualDirection === null) {
      const direction = aircon?.state;
      if (direction === "heat" || direction === "cool" || direction === "fan_only") {
        persisted.lounge.manualDirection = direction;
      }
    }
    if (action.service === "turn_off" && action.remember?.aircon?.autoMode === false) {
      persisted.lounge.manualDirection = null;
    }
  }
  if (room === "bedroom" && action.service === "turn_on") {
    await mergeDashboardPreferences({ bedroomHeater: { mode: "auto", offTimerEndsAt: null } });
    bedroomThermostat.resetForUserRequest();
  }
  if (room === "bedroom" && action.service === "turn_off") {
    await mergeDashboardPreferences({ bedroomHeater: { mode: "off", offTimerEndsAt: null } });
  }
  if (action.remember) await mergeDashboardPreferences(action.remember);
  if (room === "lounge" && action.service === "turn_off") {
    persisted.lounge.lastStopReason = "dashboard-off";
  }
  if (room === "bedroom" && action.service === "turn_off") {
    persisted.bedroom.lastStopReason = "dashboard-off";
  }
  await executeActions(room, [{
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
  autoOnMinutes?: number;
  autoOffMinutes?: number;
};

export async function applyClimateControlIntent(intent: ClimateControlIntent) {
  if (intent.mode) await claimClimateControl(intent.room);
  else await loadPersisted();
  const { aircon, heater } = await statesAndDevices();
  if (intent.room === "lounge") {
    const update: AirconPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.direction ? { hvacMode: intent.direction } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.mode ? { autoMode: intent.mode === "auto" } : {}),
    };
    await mergeDashboardPreferences({ aircon: update });
    if (intent.mode === "off" || intent.mode === "auto") persisted.lounge.manualDirection = null;
    if (intent.mode === "manual" && intent.direction) persisted.lounge.manualDirection = intent.direction;
    if (aircon && intent.mode === "off") await executeActions("lounge", [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
    if (aircon && intent.mode === "manual" && intent.direction) await executeActions("lounge", [{
      entityId: aircon.entity_id, domain: "climate", service: "set_hvac_mode", data: { hvac_mode: intent.direction },
    }]);
  } else {
    const update: BedroomHeaterPreferences = {
      ...(intent.temperature !== undefined ? { temperature: intent.temperature } : {}),
      ...(intent.offTimerEndsAt !== undefined ? { offTimerEndsAt: intent.offTimerEndsAt } : {}),
      ...(intent.autoOnMinutes !== undefined ? { autoOnMinutes: intent.autoOnMinutes } : {}),
      ...(intent.autoOffMinutes !== undefined ? { autoOffMinutes: intent.autoOffMinutes } : {}),
      ...(intent.mode ? { mode: intent.mode === "auto" ? "auto" : "off" } : {}),
    };
    await mergeDashboardPreferences({ bedroomHeater: update });
    if (heater && intent.mode === "off") await executeActions("bedroom", [{ entityId: heater.entity_id, domain: "switch", service: "turn_off" }]);
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
