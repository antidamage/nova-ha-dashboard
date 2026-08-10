/** Golden rule: autonomous climate control requires a fresh, real input. */
export const AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS = 30 * 60_000;

export type AutonomousClimateInput = {
  measurement: unknown;
  sourceState?: string;
  last_reported?: string;
  last_updated?: string;
  last_changed?: string;
};

export function autonomousClimateInputIsUsable(
  input: AutonomousClimateInput | null | undefined,
  now: number = Date.now(),
) {
  if (!input || ["unavailable", "unknown"].includes(String(input.sourceState).toLowerCase())) {
    return false;
  }
  const numericMeasurement =
    typeof input.measurement === "number"
      ? input.measurement
      : typeof input.measurement === "string" && input.measurement.trim() !== ""
        ? Number(input.measurement)
        : Number.NaN;
  if (!Number.isFinite(numericMeasurement)) {
    return false;
  }
  const stamp = input.last_reported ?? input.last_updated ?? input.last_changed;
  if (!stamp) {
    return false;
  }
  const reportedAt = Date.parse(stamp);
  return (
    Number.isFinite(reportedAt) &&
    reportedAt <= now + 60_000 &&
    now - reportedAt <= AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS
  );
}
