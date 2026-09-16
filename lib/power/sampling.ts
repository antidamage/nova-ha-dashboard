// The power sample, the monitor's timers, and meter polling.
import { callService, haRest } from "../ha";
import { readAllPowershopUsage, readPowershopAccountMetadata } from "../powershop-usage";
import type { HaState } from "../types";
import { blankWashingMachineState, type WashingMachineState } from "../washing-machine";
import { addBucket, pruneState } from "./aggregate";
import { currentKeys } from "./calendar";
import { buildDashboard } from "./dashboard";
import { estimateDevice, readRatings } from "./device-estimate";
import { maybePublishToHa } from "./ha-publish";
import { sampleMetersUnlocked } from "./meter-sampling";
import { round } from "./numbers";
import {
  blankState,
  loadRecentWashCurves,
  POWER_STATE_PATH,
  powerConfig,
  powerRuntime,
  readAccountUsage,
  readJson,
  serializePower,
  WASHING_MACHINE_PATH,
  writeJsonAtomic,
} from "./store";
import { currentRate, refreshPowerRatesIfDue } from "./tariff";
import type { PowerDashboard, PowerState } from "./types";

async function samplePowerUnlocked(): Promise<PowerDashboard> {
  const now = new Date();
  const [persisted, persistedWashing, ratings, dailyUsage, accountMetadata, states] = await Promise.all([
    readJson<PowerState>(POWER_STATE_PATH, blankState()),
    readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState()),
    readRatings(),
    readAllPowershopUsage(),
    readPowershopAccountMetadata(),
    haRest<HaState[]>("/api/states"),
  ]);
  const accountUsage = await readAccountUsage(dailyUsage, accountMetadata);
  const state = { ...blankState(), ...persisted };
  const statesById = new Map(states.map((haState) => [haState.entity_id, haState]));
  const readings = ratings.map((rating) => estimateDevice(rating, statesById, state.devices[rating.id]));
  const keys = currentKeys(now, accountMetadata?.billing);
  const rate = currentRate(now);

  const lastSampleMs = state.lastSampleAt ? new Date(state.lastSampleAt).getTime() : NaN;
  const elapsedHours = Number.isFinite(lastSampleMs) ? (now.getTime() - lastSampleMs) / 3_600_000 : 0;
  if (elapsedHours > 0 && elapsedHours <= powerConfig().timing.maxIntegrationHours) {
    for (const reading of readings) {
      const previous = state.devices[reading.id];
      const integratedWatts = previous?.lastWatts ?? reading.watts;
      const kwh = (integratedWatts * elapsedHours) / 1000;
      const costNzd = kwh * (rate.cPerKwh / 100);
      const nextTotal = (previous?.kwhTotal ?? 0) + kwh;
      state.devices[reading.id] = {
        kwhTotal: round(nextTotal, 5),
        lastEntityId: reading.entityId,
        lastState: reading.state,
        lastWatts: reading.watts,
        updatedAt: now.toISOString(),
      };
      reading.kwhTotal = round(nextTotal, 5);
      state.daily[keys.dateKey] = addBucket(state.daily[keys.dateKey], kwh, costNzd);
      state.hourly[keys.hourKey] = addBucket(state.hourly[keys.hourKey], kwh, costNzd);
    }
  } else {
    for (const reading of readings) {
      const previous = state.devices[reading.id];
      state.devices[reading.id] = {
        kwhTotal: previous?.kwhTotal ?? 0,
        lastEntityId: reading.entityId,
        lastState: reading.state,
        lastWatts: reading.watts,
        updatedAt: now.toISOString(),
      };
      reading.kwhTotal = previous?.kwhTotal ?? 0;
    }
  }

  // The metering plugs have their own faster tick (sampleMetersUnlocked,
  // specs/power-meters.md §7.3). This sample only reads what that tick stored.
  state.lastSampleAt = now.toISOString();
  await refreshPowerRatesIfDue(state, now, rate);
  pruneState(state, now);
  await writeJsonAtomic(POWER_STATE_PATH, state);
  const washing = powerConfig().washingMachine ? { ...blankWashingMachineState(), ...persistedWashing } : null;
  if (washing) {
    await loadRecentWashCurves(washing, now).catch((error) => console.warn("Wash curve loading failed", error));
  }
  const summary = buildDashboard(state, readings, accountUsage, dailyUsage, accountMetadata, now, washing);
  void maybePublishToHa(summary, ratings).catch((error) => {
    console.warn("[nova-dashboard] failed to publish power sensors", error);
  });
  return summary;
}

export async function samplePowerNow(): Promise<PowerDashboard> {
  if (!powerRuntime.samplePromise) {
    powerRuntime.samplePromise = serializePower(samplePowerUnlocked).finally(() => {
      powerRuntime.samplePromise = null;
    });
  }
  return powerRuntime.samplePromise;
}

export function sampleMetersNow(): Promise<void> {
  if (!powerRuntime.meterPromise) {
    powerRuntime.meterPromise = serializePower(sampleMetersUnlocked).finally(() => {
      powerRuntime.meterPromise = null;
    });
  }
  return powerRuntime.meterPromise;
}

/** Ask HA to refresh report-on-change meter entities (specs/power-meters.md §7.2). */
async function pollMeters() {
  const polling = powerConfig().meterPolling;
  if (!polling || powerRuntime.pollInFlight) return;
  powerRuntime.pollInFlight = true;
  const logged = (powerRuntime.pollLogged ??= { failure: false, success: false });
  try {
    await callService("homeassistant", "update_entity", { entity_id: polling.refreshEntityIds });
    if (!logged.success) {
      logged.success = true;
      console.log("[nova-dashboard] meter refresh accepted by Home Assistant", polling.refreshEntityIds);
    }
  } catch (error) {
    // Logged once: the report-on-change stream still arrives, and the next
    // interval tries again.
    if (!logged.failure) {
      logged.failure = true;
      console.warn("[nova-dashboard] meter refresh failed", error);
    }
  } finally {
    powerRuntime.pollInFlight = false;
  }
}

export function ensurePowerMonitorStarted() {
  if (powerRuntime.monitorStarted) {
    return;
  }
  powerRuntime.monitorStarted = true;
  void samplePowerNow().catch((error) => {
    console.warn("[nova-dashboard] initial power sample failed", error);
  });
  powerRuntime.timer = setInterval(() => {
    void samplePowerNow().catch((error) => {
      console.warn("[nova-dashboard] power sample failed", error);
    });
  }, powerConfig().timing.sampleIntervalMs);

  const power = powerConfig();
  if (power.floatingMeter || power.washingMachine) {
    void sampleMetersNow().catch((error) => console.warn("[nova-dashboard] initial meter sample failed", error));
    powerRuntime.meterTimer = setInterval(() => {
      void sampleMetersNow().catch((error) => console.warn("[nova-dashboard] meter sample failed", error));
    }, Math.max(1000, power.timing.meterSampleIntervalMs));
  }
  if (power.meterPolling) {
    powerRuntime.pollTimer = setInterval(() => {
      // A refused refresh is not worth surfacing: the report-on-change stream
      // still arrives, and the next interval tries again.
      void pollMeters();
    }, Math.max(1000, power.meterPolling.intervalMs));
  }
}
