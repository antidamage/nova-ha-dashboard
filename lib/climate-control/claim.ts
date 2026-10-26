import { readDashboardConfig } from "../dashboard-config";
import { airconInstances, heaterInstances, type ClimateInstance } from "../climate-instances";
import { AIRCON_COMMAND_SETTLE_MS, COMMAND_SETTLE_MS } from "./constants";
import { airconThermostatFor, heaterThermostatFor, loadPersisted, persistSoon, roomState } from "./store";
import type { RoomId } from "./types";

export async function instanceById(id: RoomId): Promise<ClimateInstance | undefined> {
  const config = await readDashboardConfig();
  return [...airconInstances(config), ...heaterInstances(config)].find((instance) => instance.id === id);
}

export async function claimClimateControl(room: RoomId) {
  await loadPersisted();
  const state = roomState(room);
  state.owner = "nova";
  state.overrideReason = null;
  // A mode the owner just chose is a request, and on the aircon it is what allows
  // a cold unit to run long enough to report a temperature (§5.2). Manual's latch
  // lives here rather than only on a target change.
  state.manualUserRequestAt = Date.now();
  const instance = await instanceById(room);
  state.commandSettleUntil = Date.now() + (instance?.kind === "aircon" ? AIRCON_COMMAND_SETTLE_MS : COMMAND_SETTLE_MS);
  // Reset only this instance's own thermostat; the others are mid-cycle on
  // their own devices and must not have their timings cleared.
  if (instance?.kind === "heater") heaterThermostatFor(room).resetForUserRequest();
  else airconThermostatFor(room).resetForUserRequest();
  await persistSoon();
}
