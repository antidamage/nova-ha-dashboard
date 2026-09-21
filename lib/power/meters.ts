// Metering-plug readings and the floating meter's tick, summary and category switch.
import type { HaState } from "../types";
import { currentKeys, dateKeyFromParts, localParts } from "./calendar";
import { numericState } from "./device-estimate";
import {
  blankFloatingMeterState,
  floatingMeterReadings,
  recordFloatingSample,
  type FloatingMeterState,
} from "./floating-meter";
import {
  blankState,
  POWER_STATE_PATH,
  powerConfig,
  readJson,
  serializePower,
  writeJsonAtomic,
} from "./store";
import type { AmpAutomationState, PowerFloatingMeterSummary, PowerState } from "./types";

/**
 * The metering plugs. Both features are optional and self-contained: each
 * helper no-ops when the household has configured no such meter, so a generic
 * install carries the code without the behaviour.
 *
 * See specs/power-meters.md.
 */

/**
 * A meter's power reading: the configured sensor, or its fallback twin while
 * that sensor is unavailable (specs/power-meters.md §7.2).
 */
export function meterReading(
  statesById: Map<string, HaState>,
  config: { fallbackPowerSensorEntityId?: string; powerSensorEntityId: string },
) {
  for (const entityId of [config.powerSensorEntityId, config.fallbackPowerSensorEntityId]) {
    if (!entityId) continue;
    const watts = numericState(statesById, entityId);
    if (watts !== null) {
      const state = statesById.get(entityId);
      return { entityId, reportedAt: state?.last_reported ?? state?.last_updated, watts };
    }
  }
  return null;
}

export function meterEntityIds(config: { energySensorEntityId?: string; fallbackPowerSensorEntityId?: string; powerSensorEntityId: string }) {
  return [config.powerSensorEntityId, config.fallbackPowerSensorEntityId, config.energySensorEntityId].filter(
    (entityId): entityId is string => Boolean(entityId),
  );
}

/**
 * Energy since the stored counter reading, from a cumulative kWh counter.
 * Undefined — fall back to held power — when there is no counter, no stored
 * reading, or the counter went backwards (a plug reset). Zero when the stored
 * reading is older than maxIntegrationHours: that gap is not integrated.
 */
export function counterDeltaKwh(
  state: PowerState,
  statesById: Map<string, HaState>,
  entityId: string | undefined,
  now: Date,
  maxIntegrationHours: number,
  powerLive: boolean,
) {
  if (!entityId) return undefined;
  // While power is unavailable nothing is recorded, so the stored reading and
  // its time are held. The next live tick sees the whole gap's energy when the
  // gap since that reading is within maxIntegrationHours, and none otherwise.
  if (!powerLive) return undefined;
  const counters = (state.meterCounters ??= {});
  const readAt = (state.meterCounterReadAt ??= {});
  const reading = numericState(statesById, entityId);
  if (reading === null) {
    // Power is live but the counter is not: drop the baseline so the next
    // reading starts a fresh one instead of claiming this gap.
    delete counters[entityId];
    delete readAt[entityId];
    return undefined;
  }
  const previous = counters[entityId];
  const previousAt = readAt[entityId] ? Date.parse(readAt[entityId]) : NaN;
  counters[entityId] = reading;
  readAt[entityId] = now.toISOString();
  if (previous === undefined || !Number.isFinite(previousAt) || reading < previous) return undefined;
  const gapHours = (now.getTime() - previousAt) / 3_600_000;
  if (gapHours <= 0 || gapHours > maxIntegrationHours) return 0;
  return reading - previous;
}

/** Which group the meter is on. Unset falls back to the first configured one. */
function activeFloatingCategoryId(state: FloatingMeterState | undefined) {
  const config = powerConfig().floatingMeter;
  if (!config) {
    return null;
  }
  const stored = state?.activeCategoryId;
  const known = config.categories.some((category) => category.id === stored);
  return known ? stored! : config.categories[0].id;
}

export function recordFloatingMeterSample(
  persisted: FloatingMeterState | undefined,
  statesById: Map<string, HaState>,
  keys: ReturnType<typeof currentKeys>,
  now: Date,
  integrationHours: number,
  energyKwh?: number,
): FloatingMeterState | undefined {
  const config = powerConfig().floatingMeter;
  if (!config) {
    return persisted;
  }
  const state: FloatingMeterState = { ...blankFloatingMeterState(), ...persisted };
  const categoryId = activeFloatingCategoryId(state)!;
  if (state.activeCategoryId !== categoryId) {
    state.activeCategoryId = categoryId;
    state.activeSince ??= now.toISOString();
  }
  const watts = meterReading(statesById, config)?.watts ?? null;
  if (watts === null) {
    // The plug is off-network. Recording a zero would teach the model that the
    // group draws nothing, which is the one thing we know it does not mean.
    return state;
  }
  recordFloatingSample(
    state,
    categoryId,
    watts,
    integrationHours * 3600,
    keys.hourKey,
    now.toISOString(),
    energyKwh === undefined ? undefined : energyKwh * 3_600_000,
  );
  return state;
}

/**
 * Move the floating meter onto another group. The outgoing segment is already
 * folded into its category's history by every sample that has run since it was
 * selected, so this only has to re-point the meter and restamp `activeSince`.
 */
export function setFloatingMeterCategory(categoryId: string) {
  // Inside the write queue: the meter tick rewrites state.json every few
  // seconds and would otherwise overwrite the new category with a stale read.
  return serializePower(() => setFloatingMeterCategoryUnlocked(categoryId));
}

async function setFloatingMeterCategoryUnlocked(categoryId: string) {
  const config = powerConfig().floatingMeter;
  if (!config || !config.categories.some((category) => category.id === categoryId)) {
    return null;
  }
  const persisted = await readJson<PowerState>(POWER_STATE_PATH, blankState());
  const state = { ...blankState(), ...persisted };
  state.floatingMeter = { ...blankFloatingMeterState(), ...state.floatingMeter };
  state.floatingMeter.activeCategoryId = categoryId;
  state.floatingMeter.activeSince = new Date().toISOString();
  await writeJsonAtomic(POWER_STATE_PATH, state);
  return categoryId;
}

/**
 * Which group the meter is on, read from disk. The amp controller asks this on
 * every tick: it is inert unless the answer is its own category
 * (specs/amp-appletv-power.md §4.2).
 */
export async function readActiveFloatingCategoryId() {
  if (!powerConfig().floatingMeter) {
    return null;
  }
  const persisted = await readJson<PowerState>(POWER_STATE_PATH, blankState());
  return activeFloatingCategoryId(persisted.floatingMeter);
}

/**
 * The amp's follow-the-Apple-TV switch, as the Grid panel's "Automate state"
 * checkbox leaves it (§7).
 *
 * Absent is ON. That is what this feature did before the checkbox existed, and
 * a state file written by an older build must not silently stop the amp
 * following the Apple TV.
 */
export function ampAutomationEnabled(state: PowerState | undefined): boolean {
  return state?.ampPowerControl?.automationEnabled ?? true;
}

/** Read from disk: the controller asks this on every tick, beside the category. */
export async function readAmpAutomationEnabled(): Promise<boolean> {
  if (!powerConfig().ampPowerControl) {
    return true;
  }
  const persisted = await readJson<PowerState>(POWER_STATE_PATH, blankState());
  return ampAutomationEnabled(persisted);
}

export function setAmpAutomationEnabled(enabled: boolean) {
  // Inside the write queue, like the category above: the meter tick rewrites
  // state.json every few seconds and would otherwise overwrite the switch with
  // a stale read.
  return serializePower(() => setAmpAutomationEnabledUnlocked(enabled));
}

async function setAmpAutomationEnabledUnlocked(enabled: boolean): Promise<AmpAutomationState> {
  const persisted = await readJson<PowerState>(POWER_STATE_PATH, blankState());
  const state = { ...blankState(), ...persisted };
  state.ampPowerControl = { automationEnabled: enabled, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(POWER_STATE_PATH, state);
  return state.ampPowerControl;
}

export function buildFloatingMeterSummary(
  state: PowerState | undefined,
  now: Date,
): PowerFloatingMeterSummary | undefined {
  const power = powerConfig();
  const config = power.floatingMeter;
  if (!config) {
    return undefined;
  }
  const persisted = state?.floatingMeter;
  const resolved: FloatingMeterState = {
    ...blankFloatingMeterState(),
    ...persisted,
    activeCategoryId: activeFloatingCategoryId(persisted),
  };
  const parts = localParts(now);
  const activeWatts = resolved.activeCategoryId
    ? resolved.categories[resolved.activeCategoryId]?.lastWatts ?? null
    : null;
  // The checkbox belongs to the amp's own row, and only to it: no amp category,
  // or a controller aimed at a category this meter does not have, means no
  // switch to draw (§7).
  const amp = power.ampPowerControl;
  const ampControl =
    amp && config.categories.some((category) => category.id === amp.categoryId)
      ? { categoryId: amp.categoryId, enabled: ampAutomationEnabled(state) }
      : undefined;
  return {
    activeCategoryId: resolved.activeCategoryId,
    ...(ampControl ? { ampControl } : {}),
    categories: floatingMeterReadings(config, resolved, {
      activeWatts,
      hourOfDay: parts.hour.toString().padStart(2, "0"),
      today: dateKeyFromParts(parts),
    }),
    watts: activeWatts,
  };
}
