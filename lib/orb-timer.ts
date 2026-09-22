import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { completeTimer, timerSoundSlot, type OrbTimer } from "./orb-timer-model";
import { emitModuleEvent, hasEventHandlers } from "./modules/runtime/hooks";

type Stored = { timer: OrbTimer | null; notified: boolean; soundSlot: number };
/** What is on disk: a timer written before the wash's timer carries no `autoComplete`. */
type StoredFile = { notified?: boolean; soundSlot?: number; timer?: (Omit<OrbTimer, "autoComplete"> & { autoComplete?: boolean }) | null };
type Store = { queue: Promise<unknown>; ticker?: ReturnType<typeof setInterval> };
const globalStore = globalThis as typeof globalThis & { __novaOrbTimer?: Store };
const store = globalStore.__novaOrbTimer ??= { queue: Promise.resolve() };
const file = () => process.env.NOVA_ORB_TIMER_FILE ?? path.join(process.cwd(), "data", "orb-timer.json");
async function read(): Promise<Stored> {
  try {
    const state = JSON.parse(await readFile(file(), "utf8")) as StoredFile;
    // An ordinary timer completes on its own clock, which is what an absent
    // `autoComplete` means. See specs/power-meters.md, "The wash's timer".
    return {
      notified: state.notified ?? false,
      soundSlot: state.soundSlot ?? -1,
      timer: state.timer ? { ...state.timer, autoComplete: state.timer.autoComplete ?? true } : null,
    };
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { timer: null, notified: false, soundSlot: -1 };
    throw error;
  }
}
async function write(state: Stored) {
  await mkdir(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state), "utf8");
  await rename(temp, file());
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const operation = store.queue.then(action);
  store.queue = operation.catch(() => undefined);
  return operation;
}
async function publish(timer: OrbTimer | null) {
  const { publishOrbTimer } = await import("./dashboard-events");
  publishOrbTimer(timer);
}
/**
 * Clock tolerance for a timer dismissal. Screens compute "Done" from their own
 * clock; one running up to 5 s ahead of the server would otherwise have its tap
 * refused (the timer not yet complete server-side) and the alert would stay on
 * every screen. A tap within 5 s of the end completes the timer at `endsAt`.
 */
const DISMISS_CLOCK_SKEW_MS = 5_000;
export function readOrbTimer() { return serial(async () => (await read()).timer); }
export function setOrbTimer(durationMs: number, icon: string, label: string, options: { autoComplete?: boolean } = {}) {
  return serial(async () => {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 8 * 3_600_000) throw new Error("Timer must be between Off and eight hours");
    const now = Date.now();
    const timer: OrbTimer | null = durationMs === 0 ? null : {
      id: randomUUID(), icon, label, durationMs, startedAt: now, endsAt: now + durationMs,
      completedAt: null, dismissedAt: null, autoComplete: options.autoComplete ?? true,
    };
    await write({ timer, notified: false, soundSlot: -1 });
    await publish(timer);
    return timer;
  });
}
/**
 * Move the running timer's end to where its driver says it is. The wash does
 * not replace the household's timer at each period — the countdown already on
 * every screen simply gets longer — and a timer that is no longer the one this
 * wash set is left exactly as it is.
 *
 * The end is assigned rather than only ever pushed out: the wash's own timer is
 * the source of that figure, and its claim is the one the household timer was
 * started from, so the two are the same instant to the millisecond.
 */
export function extendOrbTimer(id: string, endsAt: number) {
  return serial(async () => {
    const state = await read();
    const timer = state.timer;
    if (!timer || timer.id !== id || timer.completedAt !== null || timer.dismissedAt !== null) return null;
    const next: OrbTimer = { ...timer, durationMs: Math.max(0, timer.durationMs + (endsAt - timer.endsAt)), endsAt };
    await write({ ...state, timer: next });
    await publish(next);
    return next;
  });
}
/**
 * Complete the timer at the moment its driver decided, which is not always the
 * end of its own period: a wash that has been quiet long enough is finished.
 */
export function completeOrbTimerAt(id: string, at: number) {
  return serial(async () => {
    const state = await read();
    const timer = state.timer;
    if (!timer || timer.id !== id || timer.completedAt !== null || timer.dismissedAt !== null) return null;
    const next: OrbTimer = { ...timer, completedAt: at };
    await write({ ...state, timer: next });
    await publish(next);
    await notifyCompletion({ ...state, timer: next });
    return next;
  });
}
/** Take the timer off every screen, silently: no sound and no Discord. */
export function cancelOrbTimer(id: string | null) {
  return serial(async () => {
    if (!id) return false;
    const state = await read();
    if (state.timer?.id !== id) return false;
    await write({ notified: false, soundSlot: -1, timer: null });
    await publish(null);
    return true;
  });
}
export function dismissOrbTimer(id: string) {
  return serial(async () => {
    const state = await read();
    if (state.timer?.id === id && state.timer.dismissedAt === null) {
      // A screen whose clock runs a little ahead shows "Done" before the server
      // does; accept that tap instead of silently ignoring it.
      state.timer = completeTimer(state.timer, Date.now() + DISMISS_CLOCK_SKEW_MS);
      if (state.timer!.completedAt === null) return state.timer;
      await notifyCompletion(state);
      state.timer!.dismissedAt = Date.now();
      await write(state);
      await publish(state.timer);
    }
    return state.timer;
  });
}
export function claimOrbTimerSound(id: string, slot: number, repeat: boolean) {
  return serial(async () => {
    const state = await read();
    const currentSlot = timerSoundSlot(state.timer, Date.now());
    if (state.timer?.id !== id || currentSlot === null || slot !== currentSlot || (!repeat && state.soundSlot >= 0) || slot <= state.soundSlot) return false;
    state.soundSlot = slot;
    await write(state);
    return true;
  });
}
async function notifyCompletion(state: Stored) {
    const timer = state.timer;
    if (timer?.completedAt !== null && timer?.completedAt !== undefined && !timer.dismissedAt && !state.notified && hasEventHandlers("orb-timer.completed")) {
      emitModuleEvent({ id: "orb-timer.completed", at: new Date(timer.completedAt).toISOString(), source: "server",
        task: { id: timer.id, name: `${timer.label} timer finished \u2014 ${timer.durationMs / 60_000} min` },
        data: { icon: timer.icon, label: timer.label, durationMs: timer.durationMs } });
      state.notified = true;
      await write(state);
    }
}
export function tickOrbTimer() {
  return serial(async () => {
    const state = await read();
    const next = completeTimer(state.timer, Date.now());
    if (next !== state.timer) {
      state.timer = next;
      await write(state);
      await publish(next);
    }
    await notifyCompletion(state);
    return state.timer;
  });
}
export function startOrbTimer() {
  if (store.ticker) return;
  const tick = () => void tickOrbTimer().catch((error) => console.error("[orb-timer] tick failed", error));
  tick();
  store.ticker = setInterval(tick, 1000);
  store.ticker.unref?.();
}
