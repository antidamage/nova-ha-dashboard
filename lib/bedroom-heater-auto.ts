import {
  BEDROOM_HEATER_AUTO_POLL_MS,
  BedroomHeaterThermostat,
  bedroomRoomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
  bedroomTemperatureStateIsUsable,
  bedroomHeaterMode,
  bedroomHeaterScheduleEdge,
  bedroomHeaterSleepTimerExpired,
  bedroomHeaterTargetTemperature,
  bedroomHeaterWindow,
  minutesFromMidday,
} from "./bedroom-heater-control";
import { readDashboardConfig } from "./dashboard-config";
import { callService, haRest } from "./ha/client";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import type { BedroomHeaterPreferences, HaState } from "./types";

/*
 * Server-side thermostat loop for the bedroom heater.
 *
 * The air conditioner's equivalent loop (app/components/dashboard/
 * useAirconAutoMode.ts) runs in the browser and bails on document.hidden. That
 * is acceptable for a lounge unit someone is sitting in front of; it is not
 * acceptable for a bedroom heater expected to hold temperature overnight with
 * every dashboard client asleep. So this one runs in the Next.js server
 * process, started from instrumentation.ts.
 *
 * Because it runs server-side it has no access to the client's
 * isPollingPaused() command-cooldown guard, so it keeps its own: every write
 * through /api/bedroom-heater calls noteBedroomHeaterUserCommand() and the loop
 * stands down for USER_COMMAND_HOLD_MS afterwards. Without this a tick that was
 * already mid-decision can undo a button the user just pressed.
 */

const USER_COMMAND_HOLD_MS = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastUserCommandAt = 0;
let lastScheduleMinutes: number | null = null;
// Whether the loop's own last command was turn_on. Used to tell "the user
// switched it off" apart from "it was already off", so Auto can stand down for
// the former without treating a cold idle room as an override.
let lastCommandedOn = false;
const thermostat = new BedroomHeaterThermostat();

export function noteBedroomHeaterUserCommand(now: number = Date.now()) {
  lastUserCommandAt = now;
}

function userCommandCooldownActive(now: number) {
  return now - lastUserCommandAt < USER_COMMAND_HOLD_MS;
}

function firstAvailableState(states: HaState[], entityIds: readonly string[]) {
  for (const entityId of entityIds) {
    const state = states.find((candidate) => candidate.entity_id === entityId);
    if (state && !["unavailable", "unknown"].includes(state.state)) {
      return state;
    }
  }
  return undefined;
}

export async function bedroomSensorHasFreshReading(now: number = Date.now()) {
  const config = await readDashboardConfig();
  const entityIds = bedroomRoomTemperatureEntityIds(
    config.dashboard.bedroomHeater?.temperatureEntityIds ?? [],
  );
  const states = await haRest<HaState[]>("/api/states");
  return bedroomTemperatureStateIsUsable(firstAvailableState(states, entityIds), now);
}

/**
 * Apply the auto window if the clock crossed one of its endpoints since the last
 * tick, and return the mode to run the rest of this tick under.
 *
 * The window is a schedule, not a gate: it only ever acts on an edge. Between
 * edges the user's last choice stands, which is why pressing Auto at any hour
 * heats the room at that hour.
 */
async function applySchedule(settings: BedroomHeaterPreferences | undefined, nowDate: Date) {
  const nowMinutes = minutesFromMidday(nowDate);
  const previous = lastScheduleMinutes;
  lastScheduleMinutes = nowMinutes;
  const mode = bedroomHeaterMode(settings);

  // The cursor is deliberately in memory rather than in preferences: every
  // preference write records a history revision, and a cursor saved once a
  // minute would bury the user's own changes under heater noise. The cost is
  // that a restart straddling an endpoint misses that edge — a quiet failure,
  // where re-deriving the mode from the clock would be the loud one (it would
  // overrule whatever the user had just chosen).
  if (previous === null) {
    return mode;
  }

  const { start, end } = bedroomHeaterWindow(settings);
  const edge = bedroomHeaterScheduleEdge(previous, nowMinutes, start, end);
  if (edge === null) {
    return mode;
  }

  await mergeDashboardPreferences({
    bedroomHeater: {
      mode: edge,
      // A scheduled turn-on has no business inheriting an old sleep timer.
      offTimerEndsAt: null,
      updatedAt: new Date().toISOString(),
    },
  });
  thermostat.reset();
  console.log("[bedroom-heater] schedule edge -> %s", edge);
  return edge;
}

async function tick({ userInitiated = false }: { userInitiated?: boolean } = {}) {
  if (running) {
    return;
  }
  running = true;
  try {
    const now = Date.now();
    // The cooldown exists to stop the loop undoing a press. A tick the press
    // itself asked for is the one exception.
    if (!userInitiated && userCommandCooldownActive(now)) {
      return;
    }

    const preferences = await readDashboardPreferences();
    const settings = preferences.bedroomHeater;
    const modeBefore = bedroomHeaterMode(settings);
    const mode = await applySchedule(settings, new Date(now));
    const scheduledOff = mode === "off" && modeBefore !== "off";
    const sleepTimerExpired = bedroomHeaterSleepTimerExpired(settings, now);
    // Both of these mean "stop heating now" and share one shutdown path below.
    const forceOff = scheduledOff || sleepTimerExpired;
    if (mode !== "auto" && !forceOff) {
      thermostat.reset();
      return;
    }

    const config = await readDashboardConfig();
    const heaterConfig = config.dashboard.bedroomHeater;
    if (!heaterConfig?.switchEntityIds?.length) {
      return;
    }

    const states = await haRest<HaState[]>("/api/states");
    const switchState = firstAvailableState(states, heaterConfig.switchEntityIds);
    const temperatureState = firstAvailableState(
      states,
      bedroomRoomTemperatureEntityIds(heaterConfig.temperatureEntityIds ?? []),
    );
    if (!switchState) {
      return;
    }

    // A fired sleep timer or a scheduled auto-off both outrank the thermostat:
    // they mean "stop heating now", the same end state the Off button produces.
    if (forceOff) {
      thermostat.reset();
      lastCommandedOn = false;
      if (sleepTimerExpired) {
        await mergeDashboardPreferences({
          bedroomHeater: { mode: "off", offTimerEndsAt: null, updatedAt: new Date().toISOString() },
        });
      }
      if (switchState.state === "on") {
        await callService("switch", "turn_off", { entity_id: switchState.entity_id });
      }
      console.log("[bedroom-heater] %s -> off", sleepTimerExpired ? "sleep timer expired" : "scheduled auto-off");
      return;
    }

    // Someone switching the heater off by hand — the Tuya app, the wall switch,
    // Home Assistant — outranks Auto. Without this the loop reads isOn:false,
    // decides the room is cold, and commands it straight back on; the user
    // experiences a heater that cannot be turned off (observed 2026-08-08).
    // Auto's job is to hold a temperature, not to overrule a person.
    if (lastCommandedOn && switchState.state === "off") {
      lastCommandedOn = false;
      thermostat.reset();
      await mergeDashboardPreferences({
        bedroomHeater: { mode: "off", offTimerEndsAt: null, updatedAt: new Date().toISOString() },
      });
      console.log("[bedroom-heater] switched off externally while in auto -> standing down");
      return;
    }

    const measured = Number(
      bedroomTemperatureStateIsFresh(temperatureState, now) ? temperatureState?.state : Number.NaN,
    );
    const plan = thermostat.plan({
      currentTemperature: Number.isFinite(measured) ? measured : null,
      entityId: switchState.entity_id,
      isOn: switchState.state === "on",
      now,
      preferences: settings,
    });

    if (plan.reason === "sensor-fail-safe-off") {
      // Auto must never go unavailable and force a manual re-press: it stays
      // on, the heater just switches off (if it was on) and rests, same as
      // hitting target normally. planBedroomHeaterTick already tried heating
      // blind for BEDROOM_HEATER_SENSOR_GRACE_MS first; this only fires once
      // that has run out. Do NOT set mode: "off" here.
      if (switchState.state === "on") {
        await callService("switch", "turn_off", { entity_id: switchState.entity_id });
      }
      lastCommandedOn = false;
      console.error("[bedroom-heater] room sensor unavailable or stale for 2 min -> resting off, Auto stays on");
      return;
    }

    if (!plan.actions.length) {
      return;
    }

    // Re-check authority immediately before sending, exactly as the aircon loop
    // does: a press during the awaited fetches above must win.
    if (!userInitiated && userCommandCooldownActive(Date.now())) {
      return;
    }
    const current = await readDashboardPreferences();
    if (bedroomHeaterMode(current.bedroomHeater) !== "auto") {
      return;
    }

    for (const action of plan.actions) {
      await callService(action.domain, action.service, { entity_id: action.entityId });
      lastCommandedOn = action.service === "turn_on";
    }

    console.log(
      "[bedroom-heater] %s -> %s (sensor=%s target=%s)",
      plan.reason,
      plan.actions.map((action) => action.service).join(","),
      Number.isFinite(measured) ? measured.toFixed(2) : "n/a",
      bedroomHeaterTargetTemperature(settings),
    );
  } catch (error) {
    console.error("[bedroom-heater] auto tick failed", error);
  } finally {
    running = false;
  }
}

/**
 * Evaluate the thermostat right now because the user just asked for Auto.
 *
 * Without this the heater does nothing for up to a poll interval after the
 * press, which reads as a dead button. The thermostat is reset first so the
 * minimum-cycle dwell — a guard against the loop short-cycling the relay, not
 * against people — cannot swallow the request.
 */
export async function evaluateBedroomHeaterNow() {
  // Deliberately NOT thermostat.reset(): that also cleared lastTransitionAt and
  // so disabled the minimum-cycle dwell on every press. See
  // BedroomHeaterThermostat.resetForUserRequest.
  thermostat.resetForUserRequest();
  await tick({ userInitiated: true });
}

export function startBedroomHeaterAuto() {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, BEDROOM_HEATER_AUTO_POLL_MS);
  // Node keeps the process alive for interval timers; this one must never be
  // the reason the server stays up.
  timer.unref?.();
  void tick();
  console.log("[bedroom-heater] auto loop started");
}

export function stopBedroomHeaterAutoForTest() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  thermostat.reset();
  lastUserCommandAt = 0;
  lastScheduleMinutes = null;
  lastCommandedOn = false;
}
