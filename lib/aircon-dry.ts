/**
 * Dry for air conditioners that have no `dry` mode of their own
 * (specs/aircon-auto-control.md, "Dry emulation").
 *
 * Pure decisions only: lib/climate-control.ts reads the room sensors, applies
 * the dwell and executes whatever this returns.
 */
import { autonomousClimateInputIsUsable } from "./autonomous-climate-safety";

export const AIRCON_DRY_TARGET_HUMIDITY_DEFAULT_PCT = 55;
/** Above target by more than this, the unit dehumidifies by cooling. */
export const AIRCON_DRY_START_MARGIN_PCT = 3;

/**
 * `unknown`: the unit lists no modes (unavailable, or not reported yet). It may
 * well have native dry, so it is never treated as emulated.
 */
export type AirconDrySupport = "native" | "emulated" | "unknown" | null;

export function airconDrySupport(supportedModes: readonly string[], roomHasSensors: boolean): AirconDrySupport {
  if (supportedModes.length === 0) return "unknown";
  if (supportedModes.includes("dry")) return "native";
  return roomHasSensors ? "emulated" : null;
}

/** The first HA state among the ids that exists, most trusted first. */
export function firstState<T extends { entity_id: string }>(states: readonly T[], ids: readonly string[] | undefined) {
  return (ids ?? [])
    .filter((id) => id.trim().length > 0)
    .map((id) => states.find((state) => state.entity_id === id))
    .find(Boolean);
}

type SensorState = { state: string; last_reported?: string; last_updated?: string; last_changed?: string };

/** A sensor reading usable for autonomous control, or null when stale/missing. */
export function freshSensorValue(state: SensorState | undefined, now: number) {
  if (!state) return null;
  const usable = autonomousClimateInputIsUsable({ ...state, measurement: state.state, sourceState: state.state }, now);
  return usable ? Number(state.state) : null;
}

export type DryEmulationInput = {
  humidityPct: number | null;
  roomTemperatureC: number | null;
  targetHumidityPct: number;
  /** HA state of the unit: "cool", "fan_only", "off", ... */
  entityState: string;
  supportedModes: readonly string[];
  fanModes: readonly string[];
  minTemperatureC: number;
  now: number;
  lastTransitionAt: number | null;
  minDwellMs: number;
  /**
   * An off unit is only started by a fresh owner request for Dry, or when
   * emulation itself switched it off. Anything else that turned it off wins.
   */
  mayStartFromOff: boolean;
};

export type DryEmulationDecision =
  | { kind: "hold"; reason: "stale-sensors" | "dwell" | "in-band" | "already" | "off-without-request" }
  | { kind: "cool"; setpointC: number; fanMode: string | null }
  | { kind: "fan_only" }
  | { kind: "off" };

/** The unit's lowest fan speed by name, or its first listed one. */
export function lowestFanMode(fanModes: readonly string[]) {
  const order = ["quiet", "silent", "low", "medium low", "medium", "medium high", "high", "turbo"];
  const known = order.find((name) => fanModes.some((mode) => mode.toLowerCase() === name));
  return known ? fanModes.find((mode) => mode.toLowerCase() === known) ?? null : fanModes[0] ?? null;
}

export function planDryEmulationTick(input: DryEmulationInput): DryEmulationDecision {
  const { humidityPct, roomTemperatureC } = input;
  if (humidityPct === null || roomTemperatureC === null) return { kind: "hold", reason: "stale-sensors" };
  if (input.entityState === "off" && !input.mayStartFromOff) return { kind: "hold", reason: "off-without-request" };

  const cooling = input.entityState === "cool";
  const drying = humidityPct > input.targetHumidityPct + AIRCON_DRY_START_MARGIN_PCT;
  const dried = humidityPct <= input.targetHumidityPct;

  let want: "cool" | "fan_only" | "off" | null = null;
  if (drying) want = "cool";
  else if (dried) want = input.supportedModes.includes("fan_only") ? "fan_only" : "off";
  if (want === null) return { kind: "hold", reason: "in-band" };

  const setpointC = Math.max(input.minTemperatureC, Math.round(roomTemperatureC) - 1);
  if (want === "cool" && cooling) return { kind: "hold", reason: "already" };
  if (want !== "cool" && input.entityState === want) return { kind: "hold", reason: "already" };

  // Same minimum dwell as Auto between compressor transitions.
  const compressorChange = want === "cool" || cooling;
  if (
    compressorChange &&
    input.lastTransitionAt !== null &&
    input.now - input.lastTransitionAt < input.minDwellMs
  ) {
    return { kind: "hold", reason: "dwell" };
  }

  if (want === "cool") return { kind: "cool", setpointC, fanMode: lowestFanMode(input.fanModes) };
  return { kind: want };
}
