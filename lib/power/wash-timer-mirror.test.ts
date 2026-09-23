import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTE, NOW, cleanUp, fresh, openWash, readTimer, readWash, scratch, seed, tick, writeTimer } from "./wash-timer.fixtures";

/**
 * The meter tick's half of the wash's timer (specs/power-meters.md, "The wash's
 * timer"): the wash's own timer is the source, and the household timer every
 * screen reads is a mirror of it — grown on an extension, finished at the
 * machine's quiet, and released when the wash goes away.
 */

// As in `wash-timer.test.ts`: real files and dynamic imports, so the default
// timeout is not a fair budget under a full parallel run.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanUp();
});

/** A claimed wash, its timer already set by the tap. */
async function claimed() {
  const scratchFiles = scratch();
  seed(scratchFiles.data, openWash(20));
  const modules = await fresh(scratchFiles.config, scratchFiles.data, scratchFiles.preferences, scratchFiles.timerFile);
  await modules.washing.attributeOpenWashingMachineCycle();
  return { ...scratchFiles, ...modules, first: readTimer(scratchFiles.timerFile)! };
}

describe("the wash's timer on the meter tick", () => {
  it("extends while the machine is still drawing power to do a wash", async () => {
    const { data, washing, timerFile, first } = await claimed();

    await tick(washing, data, first.endsAt, 300);

    const grown = readTimer(timerFile)!;
    // The same timer, ten minutes longer: every screen simply sees a longer
    // countdown rather than a finished one.
    expect(grown.id).toBe(first.id);
    expect(grown.endsAt).toBe(first.endsAt + 10 * MINUTE);
    expect(grown.completedAt).toBeNull();
    expect(Date.parse(readWash(data).open!.timer!.endsAt)).toBe(grown.endsAt);
  });

  it("finishes at the machine's own quiet, before its period would have run out", async () => {
    const { data, washing, timerFile, first } = await claimed();

    // Three minutes of quiet, well inside the first period; the window is
    // strictly more than `stopSeconds`.
    let at = NOW + 10 * MINUTE;
    for (let i = 0; i < 6; i += 1) {
      at += 30_000;
      await tick(washing, data, at, 0);
    }

    const finished = readTimer(timerFile)!;
    expect(finished.completedAt).not.toBeNull();
    expect(finished.completedAt!).toBeLessThan(first.endsAt);
    expect(readWash(data).open?.timer?.completedAt).not.toBeNull();
    // No completion alert is configured here: the timer is the notification.
    expect(readWash(data).open?.completion).toBeUndefined();
  });

  it("does not finish a wash the machine is only soaking through", async () => {
    const { data, washing, timerFile } = await claimed();

    // Five minutes of the machine's own soak/drain draw — 4-5 W, measured
    // (specs/power-meters.md §4.1) — well inside the first period. The drum is
    // between phases, not idling, so nothing finishes: not the timer, not the
    // wash.
    let at = NOW + 10 * MINUTE;
    for (let i = 0; i < 10; i += 1) {
      at += 30_000;
      await tick(washing, data, at, 4.3);
    }

    expect(readTimer(timerFile)!.completedAt).toBeNull();
    expect(readWash(data).open?.timer?.completedAt ?? null).toBeNull();
    expect(readWash(data).cycles).toEqual([]);
  });

  it("leaves a timer the household set itself alone", async () => {
    // They replaced the wash's timer with one of their own mid-wash: the wash
    // stops driving it and never takes it back.
    const { data, washing, timerFile, first } = await claimed();
    const oven = { autoComplete: true, completedAt: null, dismissedAt: null, durationMs: 1_800_000,
      endsAt: NOW + 30 * MINUTE, icon: "fork-knife", id: "oven", label: "Check oven", startedAt: NOW };
    writeTimer(timerFile, oven);

    await tick(washing, data, first.endsAt, 300);

    expect(readTimer(timerFile)).toEqual(oven);
    // The wash's own timer still keeps its own time.
    expect(readWash(data).open?.timer?.extensions).toBe(1);
  });

  it("is not restarted by a tap that lands back on the primary person after it finished", async () => {
    const { data, washing, timerFile, first } = await claimed();
    // The machine stops and the timer finishes.
    let at = NOW + 10 * MINUTE;
    for (let i = 0; i < 6; i += 1) {
      at += 30_000;
      await tick(washing, data, at, 0);
    }
    const finished = readTimer(timerFile)!;
    expect(finished.completedAt).not.toBeNull();

    // A tap cycles the person; a wash is notified once, so coming back to the
    // primary person inside the window before the cycle closes starts no second
    // timer and chimes for nobody (specs/power-meters.md, "The wash's timer").
    await washing.attributeOpenWashingMachineCycle();
    await washing.attributeOpenWashingMachineCycle();
    await washing.attributeOpenWashingMachineCycle();

    expect(readWash(data).open?.person).toBe("addie");
    expect(readTimer(timerFile)?.id).toBe(first.id);
    expect(readTimer(timerFile)?.completedAt).toBe(finished.completedAt);
  });

  it("takes an unfinished timer off every screen when the wash closes", async () => {
    const { data, washing, timerFile, first } = await claimed();
    // A blip: claimed, but below the cycle floor, so nothing is ever completed.
    const blip = readWash(data);
    blip.open!.kwh = 0.001;
    seed(data, blip);
    expect(readTimer(timerFile)?.id).toBe(first.id);

    let at = NOW;
    for (let i = 0; i < 12; i += 1) {
      at += 30_000;
      await tick(washing, data, at, 0);
    }

    expect(readWash(data).open).toBeNull();
    expect(readTimer(timerFile)).toBeNull();
  });
});
