// Operator repairs to stored history (specs/power-meters.md §7.5).
import path from "path";
import { haRest } from "../ha";
import { meterHistoryPoints, newRebuiltWashes, reattributeFloatingBuckets, replayWashingHistory } from "../power-repair";
import { blankWashingMachineState, downsampleTrace, type WashingMachineState } from "../washing-machine";
import { localHourEndMs } from "./calendar";
import { blankFloatingMeterState } from "./floating-meter";
import {
  backupFile,
  backupStamp,
  blankState,
  POWER_STATE_PATH,
  powerConfig,
  readJson,
  serializePower,
  WASH_TRACE_DIR,
  washCurves,
  WASHING_MACHINE_PATH,
  writeJsonAtomic,
} from "./store";
import { currentRate } from "./tariff";
import type { PowerState, WashTraceFile } from "./types";

/**
 * Move a floating-meter category's history up to `until` onto another category
 * (specs/power-meters.md §7.5). Backs up the power state before changing it.
 * Null when either category is not configured.
 */
export function reattributeFloatingMeterHistory(fromCategoryId: string, toCategoryId: string, until: string) {
  return serializePower(async () => {
    const config = powerConfig().floatingMeter;
    const known = new Set(config?.categories.map((category) => category.id) ?? []);
    if (!config || !known.has(fromCategoryId) || !known.has(toCategoryId)) return null;
    const untilMs = Date.parse(until);
    if (!Number.isFinite(untilMs)) throw new Error("until must be an ISO timestamp");
    const persisted = await readJson<PowerState>(POWER_STATE_PATH, blankState());
    const state = { ...blankState(), ...persisted };
    const result = reattributeFloatingBuckets(
      { ...blankFloatingMeterState(), ...state.floatingMeter },
      { fromCategoryId, hourStartMs: (hourKey) => localHourEndMs(hourKey) - 3_600_000, toCategoryId, untilMs },
    );
    if (result.moved.length > 0) {
      await backupFile(POWER_STATE_PATH, backupStamp());
      state.floatingMeter = result.state;
      await writeJsonAtomic(POWER_STATE_PATH, state);
    }
    return { moved: result.moved };
  });
}

/**
 * Insert washes missing from the store, rebuilt from Home Assistant history
 * (specs/power-meters.md §7.5). Stored cycles are never changed. Null when no
 * washing machine is configured.
 */
export function rebuildWashingMachineHistory(from: string, to: string) {
  return serializePower(async () => {
    const power = powerConfig();
    const config = power.washingMachine;
    if (!config) return null;
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("from and to must be ISO timestamps with from before to");
    }
    const sensors = [config.powerSensorEntityId, config.fallbackPowerSensorEntityId].filter((id): id is string => Boolean(id));
    const query = new URLSearchParams({ end_time: new Date(toMs).toISOString(), filter_entity_id: sensors.join(",") });
    const history = await haRest<unknown>(
      `/api/history/period/${encodeURIComponent(new Date(fromMs).toISOString())}?${query}&minimal_response&no_attributes`,
    );
    const rebuilt = replayWashingHistory({
      config,
      costPerKwhAt: (atMs) => currentRate(new Date(atMs)).cPerKwh / 100,
      fromMs,
      maxIntegrationHours: power.timing.maxIntegrationHours,
      points: meterHistoryPoints(history, sensors),
      tickSeconds: power.timing.meterSampleIntervalMs / 1000,
      toMs,
    });
    const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
    const state = { ...blankWashingMachineState(), ...persisted };
    const inserted = newRebuiltWashes(state, rebuilt, Date.now());
    if (inserted.length > 0) {
      await backupFile(WASHING_MACHINE_PATH, backupStamp());
      state.cycles = [...state.cycles, ...inserted.map((wash) => wash.cycle)].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      await writeJsonAtomic(WASHING_MACHINE_PATH, state);
      for (const wash of inserted) {
        const file: WashTraceFile = {
          cycleId: wash.cycle.id, endedAt: wash.cycle.endedAt, kwh: wash.cycle.kwh,
          person: wash.cycle.person, points: wash.points, startedAt: wash.cycle.startedAt,
        };
        await writeJsonAtomic(path.join(WASH_TRACE_DIR, `${wash.cycle.id}.json`), file);
        washCurves.set(wash.cycle.id, downsampleTrace(wash.points));
      }
    }
    return {
      inserted: inserted.map((wash) => ({ endedAt: wash.cycle.endedAt, id: wash.cycle.id, kwh: wash.cycle.kwh, startedAt: wash.cycle.startedAt })),
    };
  });
}
