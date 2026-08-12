import type { ClimateControlOwner } from "./types";

export type ManualAirconDirection = "heat" | "cool";

/**
 * A button press that has been sent but that the controller has not reported
 * back yet. Its selection is what the control shows, so the last command wins
 * the highlight instead of the room's not-yet-caught-up actual state.
 */
export type CommandedState<T extends string> = {
  /** What was asked for. null means the press asked for no selection at all. */
  value: T | null;
  /** What the controller was reporting at the moment of the press. */
  observedAtPress: T | null;
  sentAt: number;
};

/**
 * How long an unconfirmed press keeps the highlight. Longer than the
 * controller's 12s command-settle window so a slow Gree acknowledgement still
 * confirms the normal way, short enough that a command which never landed stops
 * claiming it did.
 */
export const COMMANDED_STATE_TIMEOUT_MS = 15_000;

export function resolveCommandedState<T extends string>(input: {
  intent: CommandedState<T> | null;
  observed: T | null;
  owner: ClimateControlOwner;
  now: number;
  timeoutMs?: number;
}): { display: T | null; intent: CommandedState<T> | null } {
  const { intent, observed, owner, now } = input;
  const settled = { display: observed, intent: null };
  if (!intent) return settled;
  // The controller reports what was asked for: the press is the actual state now.
  if (observed === intent.value) return settled;
  // Someone worked the unit itself and moved it. That is the later command, and
  // an override the dashboard must not paper over. A stale "external" reading
  // from before the press does not count — the press itself reclaims Nova.
  if (owner === "external" && observed !== intent.observedAtPress) return settled;
  // The command plainly did not land. Stop showing an intent that never became true.
  if (now - intent.sentAt >= (input.timeoutMs ?? COMMANDED_STATE_TIMEOUT_MS)) return settled;
  return { display: intent.value, intent };
}

export function climateActionReclaimsOwnership(input: {
  room: "lounge" | "bedroom";
  service: string;
  autoMode?: boolean;
}) {
  return input.service === "turn_on" ||
    input.service === "turn_off" ||
    input.service === "set_hvac_mode" ||
    (input.room === "lounge" && input.autoMode === true);
}

export function actuatorChangeIsExternal(input: {
  previousSignature: string | null;
  currentSignature: string | null;
  commandSettleUntil: number;
  now: number;
}) {
  return input.previousSignature !== null &&
    input.currentSignature !== null &&
    input.previousSignature !== input.currentSignature &&
    input.now > input.commandSettleUntil;
}

export function poweredActuatorRecoveryIsExternal(input: {
  wasAvailable: boolean | null;
  currentSignature: string | null;
  commandSettleUntil: number;
  now: number;
}) {
  if (input.wasAvailable !== false || input.currentSignature === null || input.now <= input.commandSettleUntil) {
    return false;
  }
  try {
    return JSON.parse(input.currentSignature).power !== "off";
  } catch {
    return false;
  }
}

export function planManualAirconTick(input: {
  direction: ManualAirconDirection;
  isOn: boolean;
  rawTemperature: number | null;
  filteredTemperature: number | null;
  targetTemperature: number;
  now: number;
  lastTransitionAt: number | null;
  minOffMs: number;
  sensorSettleMs: number;
  resumeDriftC: number;
}) {
  const reachedTarget = input.rawTemperature !== null &&
    (input.direction === "heat"
      ? input.rawTemperature >= input.targetTemperature
      : input.rawTemperature <= input.targetTemperature);
  if (input.isOn) return reachedTarget ? "stop" as const : "hold" as const;
  if (input.filteredTemperature === null) return "hold" as const;
  const drifted = input.direction === "heat"
    ? input.filteredTemperature <= input.targetTemperature - input.resumeDriftC
    : input.filteredTemperature >= input.targetTemperature + input.resumeDriftC;
  const dwellDone = input.lastTransitionAt === null || input.now - input.lastTransitionAt >= input.minOffMs;
  const sensorSettled = input.lastTransitionAt === null || input.now - input.lastTransitionAt >= input.sensorSettleMs;
  return drifted && dwellDone && sensorSettled
    ? "start" as const
    : "hold" as const;
}
