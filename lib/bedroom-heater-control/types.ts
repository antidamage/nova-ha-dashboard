import type { BedroomHeaterMode, BedroomHeaterPreferences } from "../types";

export type BedroomHeaterAction = {
  entityId: string;
  domain: "switch";
  service: "turn_on" | "turn_off";
};

export type BedroomHeaterAutoState = {
  /** When the switch last changed state, for min-cycle enforcement. */
  lastTransitionAt: number | null;
  /** Set once the room first reaches target, cleared when it drifts back out. */
  enteredBandAt: number | null;
  /** Legacy compatibility bit: true after the immediate at-target stop. */
  tailedOff: boolean;
  /** Tracks the target so a user's new setpoint reopens a settled cycle. */
  lastTargetTemperature: number | null;
  /**
   * When Auto first started trying to run without a usable sensor reading.
   * Null once a usable reading arrives or the fail-safe fires. Bounds
   * BEDROOM_HEATER_SENSOR_GRACE_MS — see its comment above.
   */
  sensorPendingSinceAt: number | null;
};

export type BedroomHeaterPlanInput = {
  currentTemperature: number | null;
  entityId?: string;
  isOn: boolean;
  now?: number;
  preferences?: BedroomHeaterPreferences;
  state?: BedroomHeaterAutoState;
};

export type BedroomHeaterPlan = {
  actions: BedroomHeaterAction[];
  nextState: BedroomHeaterAutoState;
  /** Why the planner did what it did, for the monitoring stream. */
  reason: string;
};
