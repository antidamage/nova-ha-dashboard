/**
 * Who owns a climate actuator, and who may take it back.
 *
 * Split out of `lib/climate-control-policy.ts` (specs/agent-token-footprint.md
 * §3.3 — the facade at that path re-exports these). The subject is one question:
 * a device changed, so did a person do it or did Nova?
 */

/**
 * Who may take the device back from an automation, and who may not.
 *
 * `speaksForTheUnit` is true only when the action is aimed at the climate
 * instance's own device — the aircon's climate entity, or the heater's switch.
 * An aircon's companion controls (its quiet, fresh-air and xtra-fan switches,
 * which the caller resolves to the same instance by name) are not the unit: a
 * `turn_off` aimed at one of them is somebody switching a fan setting off, so it
 * must not reclaim ownership or latch a Manual request (2026-09-24).
 */
export function climateActionReclaimsOwnership(input: {
  room: "lounge" | "bedroom";
  service: string;
  autoMode?: boolean;
  speaksForTheUnit: boolean;
}) {
  return (input.speaksForTheUnit &&
    (input.service === "turn_on" || input.service === "turn_off" || input.service === "set_hvac_mode")) ||
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
