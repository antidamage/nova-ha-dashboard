import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { completeTimer, timerSoundSlot, type OrbTimer } from "./orb-timer-model";
import { emitModuleEvent, hasEventHandlers } from "./modules/runtime/hooks";

type Stored = { timer: OrbTimer | null; notified: boolean; soundSlot: number };
type Store = { queue: Promise<unknown>; ticker?: ReturnType<typeof setInterval> };
const globalStore = globalThis as typeof globalThis & { __novaOrbTimer?: Store };
const store = globalStore.__novaOrbTimer ??= { queue: Promise.resolve() };
const file = () => process.env.NOVA_ORB_TIMER_FILE ?? path.join(process.cwd(), "data", "orb-timer.json");
async function read(): Promise<Stored> {
  try { return JSON.parse(await readFile(file(), "utf8")) as Stored; }
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
export function readOrbTimer() { return serial(async () => (await read()).timer); }
export function setOrbTimer(durationMs: number, icon: string, label: string) {
  return serial(async () => {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 8 * 3_600_000) throw new Error("Timer must be between Off and eight hours");
    const now = Date.now();
    const timer: OrbTimer | null = durationMs === 0 ? null : {
      id: randomUUID(), icon, label, durationMs, startedAt: now, endsAt: now + durationMs,
      completedAt: null, dismissedAt: null,
    };
    await write({ timer, notified: false, soundSlot: -1 });
    await publish(timer);
    return timer;
  });
}
export function dismissOrbTimer(id: string) {
  return serial(async () => {
    const state = await read();
    if (state.timer?.id === id && state.timer.dismissedAt === null) {
      state.timer = completeTimer(state.timer, Date.now());
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
