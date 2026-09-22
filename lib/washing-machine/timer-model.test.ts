import { describe, expect, it } from "vitest";
import { advanceWashTimer, beginWashTimer, completeWashTimer } from "../washing-machine";
import type { WashTimerConfig } from "../washing-machine";

/**
 * The wash's timer's own arithmetic (specs/power-meters.md, "The wash's
 * timer"): the first period a claim starts, the extension while the machine is
 * still drawing power to do a wash, and the finish the machine's own quiet
 * decides. The cycle model is what runs it; these are the boundaries.
 */
const CONFIG: WashTimerConfig = {
  extendMinutes: 10,
  firstPeriodMinutes: 70,
  maxSampleGapSeconds: 90,
  stopSeconds: 120,
  stopWatts: 5,
};

const AT = "2026-09-23T08:00:00.000Z";
const MINUTE = 60_000;
const started = () => beginWashTimer(AT, CONFIG);

describe("the wash's timer", () => {
  it("runs its first period from the claim", () => {
    const timer = started();

    expect(timer.completedAt).toBeNull();
    expect(timer.extensions).toBe(0);
    expect(Date.parse(timer.endsAt) - Date.parse(timer.startedAt)).toBe(70 * MINUTE);
  });

  it("extends by ten minutes when a period runs out with the machine still drawing", () => {
    const timer = started();
    const endsAt = Date.parse(timer.endsAt);

    const step = advanceWashTimer(timer, {
      at: new Date(endsAt).toISOString(),
      config: CONFIG,
      drawing: true,
    });

    expect(step.extended).toBe(true);
    expect(Date.parse(step.timer.endsAt) - endsAt).toBe(10 * MINUTE);
    expect(step.timer.extensions).toBe(1);
  });

  it("extends from the period's end, not from the tick that noticed", () => {
    // The meter tick runs every 10 s, so the extension that follows the 70th
    // minute is noticed a little late. Ten minutes means ten minutes from the
    // end of the period, and 10 s of lateness per period does not accumulate.
    const timer = started();
    const endsAt = Date.parse(timer.endsAt);

    const step = advanceWashTimer(timer, {
      at: new Date(endsAt + 10_000).toISOString(),
      config: CONFIG,
      drawing: true,
    });

    expect(Date.parse(step.timer.endsAt)).toBe(endsAt + 10 * MINUTE);
  });

  it("leaves a timer alone until its period has run out", () => {
    const timer = started();

    const step = advanceWashTimer(timer, {
      at: new Date(Date.parse(timer.endsAt) - MINUTE).toISOString(),
      config: CONFIG,
      drawing: true,
    });

    expect(step.extended).toBe(false);
    expect(step.timer).toBe(timer);
  });

  it("does not extend for a machine that has stopped drawing power to do a wash", () => {
    // An expired period with the machine quiet is the moment before the stop
    // window finishes the wash, not grounds for another ten minutes.
    const timer = started();
    const endsAt = Date.parse(timer.endsAt);

    const step = advanceWashTimer(timer, {
      at: new Date(endsAt + MINUTE).toISOString(),
      config: CONFIG,
      drawing: false,
    });

    expect(step.extended).toBe(false);
    expect(step.timer.endsAt).toBe(timer.endsAt);
  });

  it("anchors a stalled period to now rather than replaying it", () => {
    // Nothing was watching for an hour after the period ended; the timer comes
    // back ten minutes long, not six periods long.
    const timer = started();
    const at = Date.parse(timer.endsAt) + 60 * MINUTE;

    const step = advanceWashTimer(timer, { at: new Date(at).toISOString(), config: CONFIG, drawing: true });

    expect(Date.parse(step.timer.endsAt)).toBe(at + 10 * MINUTE);
    expect(step.timer.extensions).toBe(1);
  });

  it("never extends a finished timer", () => {
    const done = completeWashTimer(started(), new Date(Date.parse(AT) + 40 * MINUTE).toISOString());

    const step = advanceWashTimer(done, {
      at: new Date(Date.parse(done.endsAt) + MINUTE).toISOString(),
      config: CONFIG,
      drawing: true,
    });

    expect(step.extended).toBe(false);
    expect(step.timer).toBe(done);
  });

  it("records the machine's own finish time once", () => {
    const finishedAt = new Date(Date.parse(AT) + 75 * MINUTE).toISOString();
    const done = completeWashTimer(started(), finishedAt);

    expect(done.completedAt).toBe(finishedAt);
    // A second tick must not move the finish the chime is timed from.
    expect(completeWashTimer(done, new Date(Date.parse(AT) + 90 * MINUTE).toISOString())).toBe(done);
  });
});
