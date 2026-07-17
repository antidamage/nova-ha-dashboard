/*
 * Tracks managed computers we have just told to sleep.
 *
 * A sleep command is terminal and fire-and-forget: once a managed computer is
 * on its way down, any further SSH we send - a wallpaper sync, a status poke -
 * wakes it straight back up. So when we dispatch a sleep we mark the computer
 * here, and the command paths that would otherwise reach out over SSH consult
 * this registry and stand down until the suppression window lapses.
 */

type SleepingComputerStore = {
  until: Map<string, number>;
};

const globalWithSleepingComputers = globalThis as typeof globalThis & {
  __novaSleepingComputers?: SleepingComputerStore;
};

const store =
  globalWithSleepingComputers.__novaSleepingComputers ??
  (globalWithSleepingComputers.__novaSleepingComputers = { until: new Map<string, number>() });

// How long to keep suppressing outbound commands after a sleep. Long enough to
// outlast the burst of automatic wallpaper syncs a theme change kicks off right
// after the user hits sleep; short enough that a later, deliberate sync still
// reaches the machine once it has presumably been woken by hand.
const DEFAULT_SUPPRESSION_MS = Number(process.env.NOVA_SLEEP_SUPPRESSION_MS ?? 10 * 60_000);

export function markComputerSleeping(id: string, ttlMs: number = DEFAULT_SUPPRESSION_MS, now: number = Date.now()) {
  store.until.set(id, now + Math.max(0, ttlMs));
}

export function isComputerSleeping(id: string, now: number = Date.now()): boolean {
  const until = store.until.get(id);
  if (until === undefined) {
    return false;
  }
  if (now >= until) {
    store.until.delete(id);
    return false;
  }
  return true;
}

export function clearComputerSleeping(id: string) {
  store.until.delete(id);
}

export function resetSleepingComputersForTest() {
  store.until.clear();
}
