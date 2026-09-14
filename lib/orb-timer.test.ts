// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("./dashboard-events", () => ({ publishOrbTimer: vi.fn() }));
vi.mock("./modules/runtime/hooks", () => ({ emitModuleEvent: vi.fn(), hasEventHandlers: () => true }));
import { emitModuleEvent } from "./modules/runtime/hooks";
import { setOrbTimer, tickOrbTimer, readOrbTimer, dismissOrbTimer, claimOrbTimerSound } from "./orb-timer";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "nova-orb-test-"));
  vi.stubEnv("NOVA_ORB_TIMER_FILE", path.join(directory, "timer.json"));
  vi.useFakeTimers(); vi.setSystemTime(1000000); vi.mocked(emitModuleEvent).mockClear();
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("persistent server timer", () => {
  it("cancels silently and ignores stale dismissals", async () => {
    const first = await setOrbTimer(60000, "timer", "Egg");
    await setOrbTimer(0, "timer", "Egg");
    vi.setSystemTime(2000000); await tickOrbTimer();
    expect(await readOrbTimer()).toBeNull(); expect(emitModuleEvent).not.toHaveBeenCalled();
    const second = await setOrbTimer(120000, "timer", "Tea");
    await dismissOrbTimer(first!.id); expect((await readOrbTimer())?.id).toBe(second?.id);
  });
  it("completes without clients, emits once, serializes sound claims, expires and dismisses", async () => {
    const timer = (await setOrbTimer(60000, "timer", "Egg"))!;
    vi.setSystemTime(timer.endsAt); await tickOrbTimer(); await tickOrbTimer();
    expect(emitModuleEvent).toHaveBeenCalledTimes(1);
    expect(emitModuleEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "orb-timer.completed", task: expect.objectContaining({ name: expect.stringContaining("Egg timer finished") }) }));
    expect(await Promise.all([claimOrbTimerSound(timer.id, 0, true), claimOrbTimerSound(timer.id, 0, true)])).toEqual([true, false]);
    vi.setSystemTime(timer.endsAt + 30000); expect(await claimOrbTimerSound(timer.id, 1, true)).toBe(true);
    vi.setSystemTime(timer.endsAt + 300000); expect(await claimOrbTimerSound(timer.id, 10, true)).toBe(false);
    expect((await readOrbTimer())?.dismissedAt).toBeNull();
    await dismissOrbTimer(timer.id); expect((await readOrbTimer())?.dismissedAt).not.toBeNull();
  });
  it("unconfigured timers chime only once and a tap at the deadline still notifies", async () => {
    const timer = (await setOrbTimer(60000, "timer", "Egg"))!;
    vi.setSystemTime(timer.endsAt); await tickOrbTimer();
    expect(await claimOrbTimerSound(timer.id, 0, false)).toBe(true);
    vi.setSystemTime(timer.endsAt + 30000); expect(await claimOrbTimerSound(timer.id, 1, false)).toBe(false);
    const second = (await setOrbTimer(1000, "timer", "Tea"))!;
    vi.setSystemTime(second.endsAt); await dismissOrbTimer(second.id);
    expect(emitModuleEvent).toHaveBeenCalledTimes(2);
    expect((await readOrbTimer())?.completedAt).toBe(second.endsAt);
  });
});
