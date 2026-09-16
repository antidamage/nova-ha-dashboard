import type { ClimateControlState } from "../types";

/**
 * A configured climate instance's id (see lib/climate-instances.ts). This was
 * the union "lounge" | "bedroom" — two rooms of one house, which also meant the
 * control loop could never drive a third device.
 */
export type RoomId = string;
export type Direction = "heat" | "cool" | "dry" | "fan_only";

export type PersistedRoom = {
  owner: "nova" | "external";
  observedSignature: string | null;
  commandSettleUntil: number;
  actuatorWasAvailable: boolean | null;
  overrideReason: string | null;
  lastStopReason: string | null;
  lastTransitionAt: number | null;
  settlingFromTemperature: number | null;
  sensorPendingSinceAt: number | null;
  recentStartsAt: number[];
  manualDirection: Direction | null;
  /** Change detector and latch for a Manual target the owner moved. */
  manualTargetTemperature: number | null;
  manualUserRequestAt: number | null;
  /** Emulated Dry (specs/aircon-auto-control.md): owner request not yet served. */
  dryUserRequestAt: number | null;
  /** Emulation itself switched the unit off, so it may start it again. */
  dryOffByEmulation: boolean;
  /** Emulation changed the setpoint; restore the owner's target on leaving Dry. */
  drySetpointChanged: boolean;
};

export type PersistedState = {
  version: 1;
  /** Keyed by climate instance id. */
  rooms: Record<string, PersistedRoom>;
};

export type PersistedSnapshot = PersistedState & { publicState?: ClimateControlState };

export type ClimateControlIntent = {
  room: RoomId;
  mode?: "auto" | "manual" | "off";
  direction?: Direction;
  temperature?: number;
  offTimerEndsAt?: string | null;
};
