import { isClimateEntityOn } from "../aircon-control";
import { airconInstances, heaterInstances } from "../climate-instances";
import { airconPreferencesFor, heaterPreferencesFor } from "../climate-preferences";
import { emitModuleEvent } from "../modules/runtime/hooks";
import { readDashboardPreferences } from "../preferences";
import type { ClimateControlRoomState, ClimateControlState } from "../types";
import { POLL_MS } from "./constants";
import { airconThermostatFor, heaterThermostatFor, loadPersisted, persistSoon, roomState, runtime } from "./store";
import { emulatesDry, stateReportTime, usable } from "./device-model";
import { statesAndDevices } from "./commands";
import { driveAircon, type AirconTickResult } from "./drive-aircon";
import { driveHeater, type HeaterTickResult } from "./drive-heater";

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

function publicRoom(args: Partial<ClimateControlRoomState> & Pick<ClimateControlRoomState, "mode" | "phase">): ClimateControlRoomState {
  return { ...emptyPublicRoom(), ...args };
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

export async function tick() {
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
