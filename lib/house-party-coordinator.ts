import { randomUUID } from "node:crypto";

export const HOUSE_PARTY_LEASE_MS = 5_000;
export const HOUSE_PARTY_DISPATCH_TIMEOUT_MS = 1_000;

type Session = {
  brightnessMode: HousePartyBrightnessMode | null;
  expiresAt: number;
  lastSequence: number;
  theme: HousePartyThemeTelemetry | null;
  clock: HousePartyMasterClock | null;
  timer: ReturnType<typeof setTimeout>;
};

export type HousePartyBrightnessMode = "follow" | "oppose" | "ignore";

export type HousePartyMasterClockInput = {
  trackKey: string | null;
  position: number;
  duration: number;
  playing: boolean;
  sampledAtMs: number;
};

type HousePartyMasterClock = HousePartyMasterClockInput & {
  receivedAtMs: number;
};

export type HousePartyThemeTelemetry = {
  themeId: string;
  variant: "dark" | "light";
  transitionSeconds: number;
  updatedAt: string;
};

export type HousePartyThemeRuntimeState =
  | { active: false; theme: null }
  | { active: true; theme: HousePartyThemeTelemetry | null };

type DispatchJob = {
  run: (signal: AbortSignal) => Promise<void>;
};

type Store = {
  sessions: Map<string, Session>;
  deferred: Map<string, () => Promise<void>>;
  restore: (() => Promise<void>) | null;
  pending: DispatchJob | null;
  activeController: AbortController | null;
  dispatching: boolean;
  suppressedZones: Set<string>;
};

const globalWithHouseParty = globalThis as typeof globalThis & {
  __novaHouseParty?: Store;
};

const store = globalWithHouseParty.__novaHouseParty ?? (globalWithHouseParty.__novaHouseParty = {
  sessions: new Map(),
  deferred: new Map(),
  restore: null,
  pending: null,
  activeController: null,
  dispatching: false,
  suppressedZones: new Set(),
});

function replayDeferredIfIdle() {
  if (store.sessions.size || (!store.restore && !store.deferred.size)) return;
  const restore = store.restore;
  store.restore = null;
  const jobs = [...store.deferred.values()];
  store.deferred.clear();
  void (async () => {
    if (restore) {
      try {
        await restore();
      } catch (error) {
        console.warn("[nova-dashboard] House Party lighting restore failed", error);
      }
    }
    for (const job of jobs) {
      try {
        await job();
      } catch (error) {
        console.warn("[nova-dashboard] deferred House Party lighting request failed", error);
      }
    }
  })();
}

export function endHousePartySession(id: string) {
  const session = store.sessions.get(id);
  if (!session) return false;
  clearTimeout(session.timer);
  store.sessions.delete(id);
  if (!store.sessions.size) {
    store.pending = null;
    store.activeController?.abort();
    store.activeController = null;
    store.suppressedZones.clear();
    // Let an aborted in-flight frame leave the dispatch loop before restoring
    // the baseline. Deferred automation then runs last and becomes the final
    // state for any lights it targeted while House Party was active.
    setTimeout(replayDeferredIfIdle, 0);
  }
  return true;
}

function expiryTimer(id: string) {
  return setTimeout(() => endHousePartySession(id), HOUSE_PARTY_LEASE_MS + 25);
}

export function startHousePartySession(restore?: () => Promise<void>) {
  const id = randomUUID();
  if (!store.sessions.size && restore) store.restore = restore;
  store.sessions.set(id, {
    brightnessMode: null,
    expiresAt: Date.now() + HOUSE_PARTY_LEASE_MS,
    lastSequence: -1,
    theme: null,
    clock: null,
    timer: expiryTimer(id),
  });
  return { id, leaseMs: HOUSE_PARTY_LEASE_MS };
}

function refreshSession(id: string, sequence: number) {
  const session = store.sessions.get(id);
  if (!session || session.expiresAt <= Date.now() || sequence <= session.lastSequence) {
    if (session?.expiresAt && session.expiresAt <= Date.now()) endHousePartySession(id);
    return false;
  }
  clearTimeout(session.timer);
  session.lastSequence = sequence;
  session.expiresAt = Date.now() + HOUSE_PARTY_LEASE_MS;
  session.timer = expiryTimer(id);
  return true;
}

async function dispatchLatest() {
  if (store.dispatching) return;
  store.dispatching = true;
  try {
    while (store.pending && store.sessions.size) {
      const job = store.pending;
      store.pending = null;
      const controller = new AbortController();
      store.activeController = controller;
      const timeout = setTimeout(() => controller.abort(), HOUSE_PARTY_DISPATCH_TIMEOUT_MS);
      try {
        await Promise.race([
          job.run(controller.signal),
          new Promise<void>((resolve) => {
            controller.signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[nova-dashboard] House Party frame failed", error);
        }
      } finally {
        clearTimeout(timeout);
        if (store.activeController === controller) store.activeController = null;
      }
    }
  } finally {
    store.dispatching = false;
    if (store.pending && store.sessions.size) void dispatchLatest();
  }
}

export function enqueueHousePartyFrame(
  id: string,
  sequence: number,
  run: DispatchJob["run"],
  theme?: Omit<HousePartyThemeTelemetry, "updatedAt"> | null,
  clock?: HousePartyMasterClockInput | null,
  brightnessMode?: HousePartyBrightnessMode,
) {
  if (!refreshSession(id, sequence)) return false;
  const session = store.sessions.get(id);
  if (session && theme) {
    session.theme = { ...theme, updatedAt: new Date().toISOString() };
  }
  if (session && clock) {
    session.clock = { ...clock, receivedAtMs: Date.now() };
  }
  if (session && brightnessMode) {
    session.brightnessMode = brightnessMode;
  }
  store.pending = { run };
  void dispatchLatest();
  return true;
}

export function housePartyClockRuntimeState(now = Date.now()) {
  if (!store.sessions.size) return { active: false as const, serverNowMs: now, master: null };
  const session = [...store.sessions.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0];
  const clock = session?.clock;
  if (!clock) return { active: true as const, serverNowMs: now, master: null };
  return {
    active: true as const,
    serverNowMs: now,
    master: {
      trackKey: clock.trackKey,
      position: Math.max(0, Math.min(clock.duration, clock.position
        + (clock.playing ? Math.max(0, now - clock.receivedAtMs) / 1_000 : 0))),
      duration: clock.duration,
      playing: clock.playing,
      sampledAtMs: clock.sampledAtMs,
      receivedAtMs: clock.receivedAtMs,
    },
  };
}

export function housePartyThemeRuntimeState(): HousePartyThemeRuntimeState {
  if (!store.sessions.size) return { active: false, theme: null };
  const session = [...store.sessions.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0];
  return { active: true, theme: session?.theme ?? null };
}

export function hasActiveHousePartySession() {
  return store.sessions.size > 0;
}

export function housePartyIgnoresBrightness() {
  return store.sessions.size > 0
    && [...store.sessions.values()].every((session) => session.brightnessMode === "ignore");
}

export function deferLightingForHouseParty(key: string, run: () => Promise<void>) {
  if (!hasActiveHousePartySession()) return false;
  store.deferred.set(key, run);
  return true;
}

export function setHousePartyZonePower(zoneId: string, on: boolean) {
  if (!hasActiveHousePartySession()) return;
  if (on && zoneId === "*") store.suppressedZones.clear();
  else if (on) store.suppressedZones.delete(zoneId);
  else store.suppressedZones.add(zoneId);
}

export function isHousePartyZoneSuppressed(zoneId: string) {
  return store.suppressedZones.has("*") || store.suppressedZones.has(zoneId);
}

export function resetHousePartyCoordinatorForTest() {
  for (const session of store.sessions.values()) clearTimeout(session.timer);
  store.sessions.clear();
  store.deferred.clear();
  store.restore = null;
  store.pending = null;
  store.activeController?.abort();
  store.activeController = null;
  store.dispatching = false;
  store.suppressedZones.clear();
}
