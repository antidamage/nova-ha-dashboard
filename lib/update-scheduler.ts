import { readDashboardConfig } from "./dashboard-config";
import {
  checkGitHubForUpdate,
  getUpdateStatus,
  requestUpdate,
  resolveAutoUpdate,
} from "./update";

// Server-side once-a-day update check. Runs inside the long-lived `next start`
// process (started from instrumentation.ts). It checks GitHub at a configured
// late-night hour in the user's timezone; if an update exists and auto-update
// is enabled it queues an apply request for the host updater. Manual checks and
// the update banner share the same underlying logic.

const BOOT_CHECK_DELAY_MS = 60_000;
const MIN_TIMER_MS = 60_000;

let started = false;

type ClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClockParts(now: Date, timeZone: string): ClockParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Intl can emit hour "24" at midnight; normalise to 0.
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * Milliseconds until the next occurrence of `hour:00` local time in `timeZone`.
 * Computed as the difference between two wall-clock instants, so the timezone
 * offset cancels out (good to the minute across all but the rare DST boundary
 * at the target hour, which is acceptable for a daily check).
 */
export function msUntilNextLocalHour(now: Date, timeZone: string, hour: number): number {
  const parts = wallClockParts(now, timeZone);
  const nowWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let targetWall = Date.UTC(parts.year, parts.month - 1, parts.day, hour, 0, 0);
  if (targetWall <= nowWall) {
    targetWall += 24 * 60 * 60 * 1000;
  }
  return targetWall - nowWall;
}

async function runScheduledCheck(autoApply: boolean): Promise<void> {
  try {
    await checkGitHubForUpdate();
    if (!autoApply) {
      return;
    }
    const [status, autoUpdate] = await Promise.all([getUpdateStatus(), resolveAutoUpdate()]);
    if (status.updateAvailable && autoUpdate && !status.busy) {
      await requestUpdate({ requestedBy: "scheduler" });
      console.log("[nova-update] auto-update queued for", status.latestShortSha);
    }
  } catch (error) {
    console.error("[nova-update] scheduled check failed", error);
  }
}

async function scheduleNext(): Promise<void> {
  let delay = 24 * 60 * 60 * 1000;
  try {
    const config = await readDashboardConfig();
    delay = msUntilNextLocalHour(new Date(), config.power.timeZone, config.update.checkHourLocal);
  } catch (error) {
    console.error("[nova-update] failed to compute next check time; defaulting to 24h", error);
  }
  setTimeout(() => {
    void runScheduledCheck(true).finally(() => void scheduleNext());
  }, Math.max(MIN_TIMER_MS, delay)).unref?.();
}

export function startUpdateScheduler(): void {
  if (started) {
    return;
  }
  if (process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true") {
    return;
  }
  if (process.env.NOVA_DISABLE_UPDATE_SCHEDULER === "1") {
    return;
  }
  started = true;

  // Refresh the banner shortly after boot, without auto-applying.
  setTimeout(() => {
    void runScheduledCheck(false);
  }, BOOT_CHECK_DELAY_MS).unref?.();

  void scheduleNext();
}
