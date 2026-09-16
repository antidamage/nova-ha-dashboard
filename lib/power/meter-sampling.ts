// The metering plugs' own tick.
import { readDashboardConfigSync } from "../dashboard-config";
import { haRest } from "../ha";
import type { HaState } from "../types";
import { reconcileWashCompletion } from "../wash-completion";
import { blankWashingMachineState, type WashingMachineState } from "../washing-machine";
import { currentKeys } from "./calendar";
import { counterDeltaKwh, meterEntityIds, meterReading, recordFloatingMeterSample } from "./meters";
import {
  blankState,
  loadRecentWashCurves,
  POWER_STATE_PATH,
  powerConfig,
  powerRuntime,
  readJson,
  recordWashTrace,
  WASHING_MACHINE_PATH,
  writeJsonAtomic,
} from "./store";
import { currentRate } from "./tariff";
import type { PowerState } from "./types";
import { recordWashingMachineTick, washReconcileSignature } from "./washing";

/**
 * The metering plugs' tick (specs/power-meters.md §7.3): floating-meter
 * accumulation, wash detection, completion and traces, at
 * `power.timing.meterSampleIntervalMs`. Reads only the meter entities, plus the
 * weather and sun entities the completion's drying advice needs.
 */
export async function sampleMetersUnlocked(): Promise<void> {
  const config = powerConfig();
  if (!config.floatingMeter && !config.washingMachine) return;
  const dashboardConfig = readDashboardConfigSync();
  const entityIds = [
    ...(config.floatingMeter ? meterEntityIds(config.floatingMeter) : []),
    ...(config.washingMachine ? meterEntityIds(config.washingMachine) : []),
  ];
  const now = new Date();
  const [persisted, persistedWashing] = await Promise.all([
    readJson<PowerState>(POWER_STATE_PATH, blankState()),
    readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState()),
  ]);
  // Weather and sun only feed a completion's drying advice, which can only
  // happen while a wash is open.
  if (config.washingMachine?.completionAlert?.enabled && persistedWashing.open) {
    entityIds.push(dashboardConfig.homeAssistant.weatherEntityId, dashboardConfig.homeAssistant.sunEntityId);
  }
  const [fetched] = await Promise.all([
    Promise.all(
      [...new Set(entityIds)].map((entityId) =>
        haRest<HaState>(`/api/states/${encodeURIComponent(entityId)}`).catch(() => null),
      ),
    ),
  ]);
  const statesById = new Map(
    fetched.filter((haState): haState is HaState => Boolean(haState?.entity_id)).map((haState) => [haState.entity_id, haState]),
  );
  const state = { ...blankState(), ...persisted };
  const keys = currentKeys(now);
  const rate = currentRate(now);
  const lastMs = state.lastMeterSampleAt ? Date.parse(state.lastMeterSampleAt) : NaN;
  const elapsedHours = Number.isFinite(lastMs) ? (now.getTime() - lastMs) / 3_600_000 : 0;
  const integrate = elapsedHours > 0 && elapsedHours <= config.timing.maxIntegrationHours;
  const integrationHours = integrate ? elapsedHours : 0;

  if (config.floatingMeter) {
    const energyKwh = counterDeltaKwh(state, statesById, config.floatingMeter.energySensorEntityId, now, config.timing.maxIntegrationHours,
      meterReading(statesById, config.floatingMeter) !== null);
    state.floatingMeter = recordFloatingMeterSample(state.floatingMeter, statesById, keys, now, integrationHours, energyKwh);
  }
  state.lastMeterSampleAt = now.toISOString();

  let washing: WashingMachineState | null = null;
  const knownWashIds = new Set((persistedWashing.cycles ?? []).map((cycle) => cycle.id));
  if (config.washingMachine) {
    const energyKwh = counterDeltaKwh(state, statesById, config.washingMachine.energySensorEntityId, now, config.timing.maxIntegrationHours,
      meterReading(statesById, config.washingMachine) !== null);
    washing = recordWashingMachineTick(
      { ...blankWashingMachineState(), ...persistedWashing },
      statesById,
      now,
      integrationHours,
      rate.cPerKwh / 100,
      energyKwh,
    );
  }
  await writeJsonAtomic(POWER_STATE_PATH, state);
  if (washing) {
    const settled = washing;
    // Reconcile only when something it acts on changed — a wash opening,
    // being claimed, completing, closing or being discarded — and once after
    // start-up, so reminder.due is emitted on the completion edge, not every tick.
    const signature = washReconcileSignature(settled);
    // A once-a-minute backstop catches anything the signature misses, such as
    // a reminder changed from elsewhere.
    const backstopDue = Date.now() - (powerRuntime.washReconciledAt ?? 0) >= 60_000;
    if (signature !== powerRuntime.washReconcileSignature || backstopDue) {
      await reconcileWashCompletion(settled, statesById)
        .then(() => {
          powerRuntime.washReconcileSignature = signature;
          powerRuntime.washReconciledAt = Date.now();
        })
        .catch((error) => console.warn("Wash reminder reconciliation failed", error));
    }
    await writeJsonAtomic(WASHING_MACHINE_PATH, settled);
    const watts = config.washingMachine ? meterReading(statesById, config.washingMachine)?.watts ?? null : null;
    await recordWashTrace(knownWashIds, settled, watts, now)
      .then(() => loadRecentWashCurves(settled, now))
      .catch((error) => console.warn("Wash trace recording failed", error));
  }
}
