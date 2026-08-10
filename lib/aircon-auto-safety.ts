import { airconAutoMeasuredTemperature, dashboardAirconEntity } from "./aircon-control";
import { callService, haRest } from "./ha/client";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import type { HaState } from "./types";

export const AIRCON_AUTO_SAFETY_POLL_MS = 10_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Prove that the exact climate entity Auto will command has fresh real input.
 * On failure, make the safe state durable before reporting the rejection.
 */
export async function enforceFreshAirconAutoInput(entityId?: string, now: number = Date.now()) {
  const states = await haRest<HaState[]>("/api/states");
  const entity = entityId
    ? states.find((candidate) => candidate.entity_id === entityId)
    : dashboardAirconEntity(states);

  if (entity && airconAutoMeasuredTemperature(entity, now) !== null) {
    return true;
  }

  // Turning off must be attempted, but a disconnected entity must not prevent
  // Auto itself from being cleared. Once cleared, no controller can restart it
  // until a person chooses Auto after a fresh reading arrives.
  if (entity && entity.state !== "off") {
    try {
      await callService("climate", "turn_off", { entity_id: entity.entity_id });
    } catch (error) {
      console.error("[aircon-auto-safety] failed to turn stale-input climate entity off", error);
    }
  }
  await mergeDashboardPreferences({ aircon: { autoMode: false, offTimerEndsAt: null } });
  console.error("[aircon-auto-safety] input missing, invalid, or stale -> locked out and off", {
    entityId: entity?.entity_id ?? entityId ?? null,
  });
  return false;
}

async function tick() {
  if (running) {
    return;
  }
  running = true;
  try {
    const preferences = await readDashboardPreferences();
    if (preferences.aircon?.autoMode) {
      await enforceFreshAirconAutoInput();
    }
  } catch (error) {
    console.error("[aircon-auto-safety] watchdog tick failed", error);
  } finally {
    running = false;
  }
}

export function startAirconAutoSafetyWatchdog() {
  if (timer) {
    return;
  }
  timer = setInterval(() => void tick(), AIRCON_AUTO_SAFETY_POLL_MS);
  timer.unref?.();
  void tick();
  console.log("[aircon-auto-safety] watchdog started");
}

export function stopAirconAutoSafetyWatchdogForTest() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
}
