import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE, NOW, cleanUp, fresh, openWash, readTimer, readWash, scratch, seed, tick } from "./wash-timer.fixtures";

/**
 * The wash's timer is the household's own timer, driven by the machine
 * (specs/power-meters.md, "The wash's timer"): the tap that claims the wash sets
 * it for the first period, and everything that sounds or flashes afterwards is
 * the timer's own. These cases drive the claim path the way the running app
 * does; the meter tick's half is in `wash-timer-mirror.test.ts`.
 */

// These cases write real files and import the power stack dynamically, which on
// a cold module graph is seconds of work under a full parallel run; the default
// 5 s budget is for logic, not for I/O.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  // The timer is read back as a clock time, so the claim is pinned to NOW
  // rather than to whenever the suite ran.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanUp();
});

describe("the wash's timer", () => {
  it("is started by the tap that claims the wash, for its first period", async () => {
    const { config, data, preferences, timerFile } = scratch();
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);

    await washing.attributeOpenWashingMachineCycle();

    const timer = readTimer(timerFile);
    expect(timer?.durationMs).toBe(70 * MINUTE);
    expect(timer?.endsAt).toBe(NOW + 70 * MINUTE);
    // The household's own first timer icon: their glyph, their label.
    expect(timer?.icon).toBe("tshirt");
    expect(timer?.label).toBe("Wash clothes");
    // The machine ends it, never its own clock.
    expect(timer?.autoComplete).toBe(false);
    // The wash remembers which timer it set, so a tick can grow that one.
    expect(readWash(data).open?.timer?.orbTimerId).toBe(timer?.id);
  });

  it("keeps counting when someone else's tap takes the wash off the primary person, and stops notifying", async () => {
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);
    await washing.attributeOpenWashingMachineCycle();
    const claimedTimer = readTimer(timerFile);
    expect(claimedTimer?.label).toBe("Wash clothes");
    expect(claimedTimer?.washNotify).toBe(true);

    // alex -> sam: the countdown stays on every screen, but finishing is quiet.
    await washing.attributeOpenWashingMachineCycle();

    expect(readTimer(timerFile)?.id).toBe(claimedTimer?.id);
    expect(readTimer(timerFile)?.washNotify).toBe(false);
    expect(readWash(data).open?.person).toBe("sam");
    expect(readWash(data).open?.timer?.notify).toBe(false);
  });

  it("counts down any confirmed wash, quietly until it is claimed", async () => {
    const { config, data, preferences, timerFile } = scratch();
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);

    await tick(washing, data, NOW + 30_000, 220);

    const started = readTimer(timerFile);
    expect(started?.durationMs).toBe(70 * MINUTE);
    expect(started?.washNotify).toBe(false);
    expect(readWash(data).open?.timer?.orbTimerId).toBe(started?.id);

    // The orb's bell: the same timer, now one that will notify.
    await washing.setOpenWashNotify(true);
    expect(readTimer(timerFile)?.id).toBe(started?.id);
    expect(readTimer(timerFile)?.washNotify).toBe(true);
    expect(readWash(data).open?.person).toBe("alex");
    await washing.setOpenWashNotify(false);
    expect(readTimer(timerFile)?.washNotify).toBe(false);
    expect(readWash(data).open?.person).toBeNull();
  });

  it("does not replace a timer the household already has running", async () => {
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);

    await tick(washing, data, NOW + 30_000, 220);

    expect(readTimer(timerFile)?.label).toBe("Check oven");
    // The wash still has its own countdown, for the washing entry alone.
    expect(readWash(data).open?.timer?.orbTimerId).toBeNull();
    expect(readWash(data).open?.timer?.notify).toBe(false);
  });

  it("finishes an unclaimed wash silently: the countdown goes without an alert", async () => {
    const { config, data, preferences, timerFile } = scratch();
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);
    await tick(washing, data, NOW + 30_000, 220);
    expect(readTimer(timerFile)).not.toBeNull();

    let at = NOW + 30_000;
    for (let i = 0; i < 6; i += 1) {
      at += 30_000;
      await tick(washing, data, at, 0);
    }

    expect(readTimer(timerFile)).toBeNull();
    expect(readWash(data).open?.timer?.completedAt).not.toBeNull();
  });

  it("is not started for a wash whose completion has already been captured", async () => {
    // The window between the completion edge and the cycle closing: the finished
    // wash is still on screen and still tappable, and a countdown for it must not
    // replace the timer the household is already running.
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    const { timer } = await fresh(config, data, preferences, timerFile);

    expect(await timer.setWashTimer({
      ...openWash(20, "alex").open!,
      completion: { at: new Date(NOW).toISOString(), discord: true, person: "alex" },
    }, new Date(NOW))).toBeUndefined();
    expect(readTimer(timerFile)?.label).toBe("Check oven");
  });

  it("falls back to the default icon when the household has configured none", async () => {
    const { config, data, preferences, timerFile } = scratch({ timerIcons: null });
    seed(data, openWash(10, "alex"));
    const { timer } = await fresh(config, data, preferences, timerFile);

    await timer.setWashTimer(openWash(10, "alex").open!, new Date(NOW));

    expect(readTimer(timerFile)?.icon).toBe("timer");
    expect(readTimer(timerFile)?.label).toBe("Countdown");
  });
});
