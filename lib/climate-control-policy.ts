export type ManualAirconDirection = "heat" | "cool";

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

export function planManualAirconTick(input: {
  direction: ManualAirconDirection;
  isOn: boolean;
  rawTemperature: number | null;
  filteredTemperature: number | null;
  targetTemperature: number;
  now: number;
  lastTransitionAt: number | null;
  recentStartsAt: number[];
  minOffMs: number;
  resumeDriftC: number;
  maxStartsPerHour: number;
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
  return drifted && dwellDone && input.recentStartsAt.length < input.maxStartsPerHour
    ? "start" as const
    : "hold" as const;
}
