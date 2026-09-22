import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE, NOW, cleanUp, fresh, openWash, readTimer, readWash, scratch, seed } from "./wash-timer.fixtures";

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

  it("is not started when someone else's tap claims the wash, and the wash's own timer goes with it", async () => {
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);
    await washing.attributeOpenWashingMachineCycle();
    expect(readTimer(timerFile)?.label).toBe("Wash clothes");

    // Addie -> Tonya: the tap is a claim, just not the primary person's, and the
    // timer the wash had started is taken off every screen.
    await washing.attributeOpenWashingMachineCycle();

    expect(readTimer(timerFile)).toBeNull();
    expect(readWash(data).open?.person).toBe("tonya");
    expect(readWash(data).open?.timer).toBeUndefined();
  });

  it("is not started for a wash whose completion has already been captured", async () => {
    // The window between the completion edge and the cycle closing: the finished
    // wash is still on screen and still tappable, and a countdown for it must not
    // replace the timer the household is already running.
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    const { timer } = await fresh(config, data, preferences, timerFile);

    expect(await timer.setWashTimer({
      ...openWash(20, "addie").open!,
      completion: { at: new Date(NOW).toISOString(), discord: true, person: "addie" },
    }, new Date(NOW))).toBeUndefined();
    expect(readTimer(timerFile)?.label).toBe("Check oven");
  });

  it("falls back to the default icon when the household has configured none", async () => {
    const { config, data, preferences, timerFile } = scratch({ timerIcons: null });
    seed(data, openWash(10, "addie"));
    const { timer } = await fresh(config, data, preferences, timerFile);

    await timer.setWashTimer(openWash(10, "addie").open!, new Date(NOW));

    expect(readTimer(timerFile)?.icon).toBe("timer");
    expect(readTimer(timerFile)?.label).toBe("Countdown");
  });
});
