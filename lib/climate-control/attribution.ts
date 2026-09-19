import { emitDashboardEventNoWait } from "../event-spool";

/**
 * One autonomous climate write, with the reason the controller made it.
 *
 * Route attribution (specs/bedroom-heater-control-integrity.md §5) answers
 * "which caller", and so by construction says nothing about the writes no
 * caller made. The controller's own paths — sensor fail-safe, sleep-timer
 * expiry, thermostat transitions — recorded nothing at all, which left the
 * 2026-09-19 "it stops turning on" report unanswerable from the logs.
 *
 * The caller fields stay absent rather than being attributed to whichever
 * client happened to be polling at the time.
 */
export type ClimateControllerWrite = {
  instanceId: string;
  /** The controller's own vocabulary: sensor-timeout, timer-expired, nova-off, … */
  reason: string;
  modeBefore?: string | null;
  modeAfter?: string | null;
  targetBefore?: number | null;
  targetAfter?: number | null;
  /** The setpoint in force when the decision was made, when it did not change. */
  target?: number | null;
  /** The reading the decision was made on, or null with why it was unusable. */
  sensorTemperature?: number | null;
  sensorAgeSeconds?: number | null;
  sensorUnusableReason?: string | null;
};

export function emitClimateControllerWrite(write: ClimateControllerWrite): void {
  emitDashboardEventNoWait({
    service: "heating",
    event: "climate-controller-write",
    source: "climate-controller",
    detail: {
      instanceId: write.instanceId,
      reason: write.reason,
      modeBefore: write.modeBefore,
      modeAfter: write.modeAfter,
      targetBefore: write.targetBefore,
      targetAfter: write.targetAfter,
      target: write.target,
      sensorTemperature: write.sensorTemperature,
      sensorAgeSeconds: write.sensorAgeSeconds,
      sensorUnusableReason: write.sensorUnusableReason,
    },
  });
}
