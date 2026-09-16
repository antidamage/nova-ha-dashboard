import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AirconAutoThermostat } from "../aircon-control";
import { BedroomHeaterThermostat } from "../bedroom-heater-control";
import type { ClimateControlState } from "../types";
import type { PersistedRoom, PersistedSnapshot, PersistedState, RoomId } from "./types";

const STATE_PATH = process.env.NOVA_CLIMATE_CONTROL_STATE ?? path.join(process.cwd(), "data", "climate-control.json");

export function defaultRoom(): PersistedRoom {
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
export const runtime: ClimateControlRuntime = climateGlobal.__novaClimateControlRuntime ??= {
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
export function roomState(id: RoomId): PersistedRoom {
  return (persisted.rooms[id] ??= defaultRoom());
}

export function airconThermostatFor(id: RoomId) {
  let thermostat = runtime.airconThermostats.get(id);
  if (!thermostat) {
    thermostat = new AirconAutoThermostat();
    runtime.airconThermostats.set(id, thermostat);
  }
  return thermostat;
}

export function heaterThermostatFor(id: RoomId) {
  let thermostat = runtime.heaterThermostats.get(id);
  if (!thermostat) {
    thermostat = new BedroomHeaterThermostat();
    runtime.heaterThermostats.set(id, thermostat);
  }
  return thermostat;
}

export function samplesFor(id: RoomId) {
  let buffer = runtime.samples.get(id);
  if (!buffer) {
    buffer = [];
    runtime.samples.set(id, buffer);
  }
  return buffer;
}

export async function loadPersisted() {
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

export function persistSoon() {
  const snapshot = JSON.stringify({ ...persisted, publicState: runtime.publicState }, null, 2) + "\n";
  runtime.writeQueue = runtime.writeQueue.then(async () => {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.${process.pid}.tmp`;
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, STATE_PATH);
  });
  return runtime.writeQueue;
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
