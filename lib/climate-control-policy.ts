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

/**
 * Infer the equilibrium input of a first-order thermal sensor from one point
 * on its post-step response:
 *
 *   measured(t) = settled + (atTransition - settled) * exp(-t / tau)
 *
 * This is deliberately a small, inspectable model. It returns null where the
 * transient is too young or malformed rather than manufacturing a prediction.
 */
export function estimateFirstOrderSettledTemperature(input: {
  atTransition: number;
  current: number;
  elapsedMs: number;
  timeConstantMs: number;
}) {
  if (
    !Number.isFinite(input.atTransition) ||
    !Number.isFinite(input.current) ||
    !Number.isFinite(input.elapsedMs) ||
    !Number.isFinite(input.timeConstantMs) ||
    input.elapsedMs <= 0 ||
    input.timeConstantMs <= 0
  ) {
    return null;
  }
  const remainingFraction = Math.exp(-input.elapsedMs / input.timeConstantMs);
  const observedFraction = 1 - remainingFraction;
  if (observedFraction <= 0) return null;
  const estimate = (input.current - input.atTransition * remainingFraction) / observedFraction;
  return Number.isFinite(estimate) ? estimate : null;
}

/**
 * Whether a post-stop trend is strong enough to resume the SAME HVAC direction
 * before the conservative full-settling timeout.
 *
 * The direction test matters as much as the extrapolation: after Heat stops the
 * biased indoor-unit reading must be moving down; after Cool stops it must be
 * moving up. A flat, opposite, or cross-direction trace is never accelerated.
 */
export function settlingTrendSupportsSameDirectionRestart(input: {
  direction: ManualAirconDirection;
  atTransition: number | null;
  current: number;
  target: number;
  elapsedMs: number;
  timeConstantMs: number;
  resumeDriftC: number;
  measurementResolutionC: number;
}) {
  if (input.atTransition === null || !Number.isFinite(input.atTransition)) return false;
  const drift = input.current - input.atTransition;
  const expectedDirection = input.direction === "heat" ? drift < 0 : drift > 0;
  if (!expectedDirection) return false;
  const halfStep = Number.isFinite(input.measurementResolutionC) && input.measurementResolutionC > 0
    ? input.measurementResolutionC / 2
    : 0;
  // Use the least favourable values allowed by whole-degree quantisation: the
  // warmest possible equilibrium for Heat, and coldest for Cool. An early
  // restart must survive this bound, not merely fit the displayed integers.
  const conservativeAtTransition = input.direction === "heat"
    ? input.atTransition - halfStep
    : input.atTransition + halfStep;
  const conservativeCurrent = input.direction === "heat"
    ? input.current + halfStep
    : input.current - halfStep;
  const estimated = estimateFirstOrderSettledTemperature({
    atTransition: conservativeAtTransition,
    current: conservativeCurrent,
    elapsedMs: input.elapsedMs,
    timeConstantMs: input.timeConstantMs,
  });
  if (estimated === null) return false;
  const minimumTrueDrift = Math.max(0, input.resumeDriftC - halfStep);
  return input.direction === "heat"
    ? estimated <= input.target - minimumTrueDrift
    : estimated >= input.target + minimumTrueDrift;
}

export function planManualAirconTick(input: {
  direction: ManualAirconDirection;
  isOn: boolean;
  rawTemperature: number | null;
  filteredTemperature: number | null;
  targetTemperature: number;
  now: number;
  lastTransitionAt: number | null;
  settlingFromTemperature: number | null;
  minOffMs: number;
  sensorSettleMs: number;
  sensorTimeConstantMs: number;
  sensorResolutionC: number;
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
  const elapsedMs = input.lastTransitionAt === null ? Number.POSITIVE_INFINITY : input.now - input.lastTransitionAt;
  const dwellDone = elapsedMs >= input.minOffMs;
  const sensorSettled = elapsedMs >= input.sensorSettleMs;
  const trendSupportsRestart = elapsedMs >= input.minOffMs && settlingTrendSupportsSameDirectionRestart({
    direction: input.direction,
    atTransition: input.settlingFromTemperature,
    current: input.filteredTemperature,
    target: input.targetTemperature,
    elapsedMs,
    timeConstantMs: input.sensorTimeConstantMs,
    resumeDriftC: input.resumeDriftC,
    measurementResolutionC: input.sensorResolutionC,
  });
  return drifted && dwellDone && (sensorSettled || trendSupportsRestart)
    ? "start" as const
    : "hold" as const;
}
