// The wash-cycle thresholds as the fixed plug is actually metered, and the
// state machine that dates a cycle. Split out of `washing-machine.test.ts`,
// which is over the 10 KB cap with both suites in it
// (specs/agent-token-footprint.md section 3).
import { describe, expect, it } from "vitest";
import { recordWashingMachineSample } from "../washing-machine";
import { WashingMachineConfigSchema } from "../config-schema/washing-machine";
import { METERED_CONFIG, replay } from "./washing-machine.fixtures";

describe("the close window and the wash's own timer", () => {
  it("keeps both floors under the pause floor, and both windows in order", () => {
    // The timer is the notification edge; the close is the storage edge that
    // follows it. A window no longer than `timer.stopSeconds` tears the wash
    // down - and its timer with it - on the same tick, before it was finished,
    // which is what the timer's mirror tests catch.
    //
    // And both floors are the machine being off, not the machine pausing: a
    // wash's own soak and drain pauses read 4-5 W (§4.1), so a threshold above
    // them calls a running wash stopped.
    const shipped = WashingMachineConfigSchema.parse({ entityIds: ["switch.washing_machine"], powerSensorEntityId: "sensor.washing_machine_power" });

    expect(shipped.endQuietSeconds).toBeGreaterThan(shipped.timer.stopSeconds);
    expect(shipped.timer.stopWatts).toBeLessThanOrEqual(shipped.endWatts);
    expect(shipped.endWatts).toBeLessThan(4);
  });
});

describe("washing-machine cycle detection at the metered thresholds", () => {
  /** Replayed against the thresholds the fixed plug actually reads (§4.1). */
  const metres = (trace: Array<[number, number]>) => replay(trace, undefined, METERED_CONFIG);

  it("splits two loads with a few quiet minutes between them", () => {
    // Measured on 2026-09-23: one load stopped at 0 W and the next woke 3m48s
    // later. The 5 W / 300 s pair ran the two into one 2h11m wash; the retuned
    // 2 W / 180 s pair closes the first and opens the second.
    const trace: Array<[number, number]> = [
      [1, 10],
      [400, 20],
      [0, 4],
      [400, 20],
      [0, 8],
    ];

    expect(replay(trace).cycles).toHaveLength(1);
    expect(metres(trace).cycles).toHaveLength(2);
  });

  it("does not split a wash across a five-minute soak", () => {
    // The machine's own soak and drain pauses hold 4-5 W for minutes at a time
    // (4.6 minutes is the longest measured), so a long quiet window was never
    // what protected a wash — the threshold is. At 5 W this one splits in two.
    const trace: Array<[number, number]> = [
      [1, 10],
      [400, 20],
      [4.3, 5.5],
      [400, 20],
      [0, 10],
    ];

    expect(replay(trace).cycles).toHaveLength(2);
    expect(metres(trace).cycles).toHaveLength(1);
  });

  it("treats the soak floor as awake, not silent, however long it lasts", () => {
    // Fifteen minutes at 4.2 W, mid-wash. The same trace splits into two cycles
    // under the shipped 5 W pair — where a soak IS silence — and stays one wash
    // at 2 W, where it is the dead band.
    const trace: Array<[number, number]> = [
      [1, 10],
      [400, 20],
      [4.2, 15],
      [400, 10],
      [0, 6],
    ];

    expect(replay(trace).cycles).toHaveLength(2);
    expect(metres(trace).cycles).toHaveLength(1);
  });

  it("dates a wash from the machine waking, not from the drum's second burst", () => {
    // 2026-09-23's second load: an 18 W wake and a 112 W fill burst, a 46 s
    // drop to 9 W in the fill, then the tumble. The fill's own pause used to
    // reset the rise, so the wash was dated from the tumble minutes later.
    const state = metres([
      [0, 5],
      [18, 1],
      [9, 1],
      [120, 30],
      [0, 10],
    ]);

    expect(state.cycles).toHaveLength(1);
    // The wake: the first sample above the off floor, five minutes in.
    expect(state.cycles[0].startedAt).toBe("2026-09-14T08:05:30.000Z");
    // Every tick from the wake to the close, at what it actually drew.
    expect(state.cycles[0].kwh).toBeCloseTo(0.0604, 3);
  });

  it("does not let a machine left awake and idle date a wash", () => {
    // Woken at 18 W, then a lit panel at 9 W for six minutes. A pause longer
    // than the rise it needs means this was never that rise, so the wash is
    // dated from the drum rather than six minutes early.
    const state = metres([
      [0, 5],
      [18, 1],
      [9, 6],
      [120, 30],
      [0, 10],
    ]);

    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0].startedAt).toBe("2026-09-14T08:12:30.000Z");
  });

  it("closes on the quiet window, and not before it", () => {
    // The window is observed time from the sample that saw the drop: 150
    // seconds of silence is short of 180, and 180 closes it.
    expect(metres([[1, 10], [400, 20], [0, 3]]).cycles).toEqual([]);
    expect(metres([[1, 10], [400, 20], [0, 3]]).open?.startedAt).toBe("2026-09-14T08:10:30.000Z");
    expect(metres([[1, 10], [400, 20], [0, 3.5]]).cycles).toHaveLength(1);
  });

  it("does not re-arm a wake while the machine stays awake and idle", () => {
    // An hour at 9 W: a lit panel with nothing running. One wake, abandoned —
    // not a fresh one every tick, which is what kept a non-null open record and
    // its trace sidecar alive for a machine that never washed.
    const state = metres([
      [0, 5],
      [18, 1],
      [9, 60],
    ]);

    expect(state.cycles).toEqual([]);
    expect(state.open?.wokeAt ?? null).toBeNull();
  });

  it("arms a fresh wake when the load starts after the panel has been lit", () => {
    // The panel sits in the dead band long enough to abandon a wake of its own,
    // then the load starts: the fill's next dip must be counted from the 18 W
    // rise, not against the idle time before it, or the wash is dated from its
    // drum after all.
    const state = metres([
      [0, 5],
      [9, 10],
      [18, 1],
      [9, 1],
      [120, 30],
      [0, 10],
    ]);

    expect(state.cycles).toHaveLength(1);
    // The 18 W rise, five minutes after the panel's own dead band began.
    expect(state.cycles[0].startedAt).toBe("2026-09-14T08:15:30.000Z");
  });

  it("keeps a wake through a fill that dips more than once", () => {
    // Three short dips, each well inside the rise a wash needs. Counted per
    // pause the wake stands; counted against the machine's total time below
    // startWatts it would not, and the wash would be dated from its drum.
    const state = metres([
      [0, 5],
      [18, 1],
      [9, 1],
      [18, 1],
      [9, 1],
      [18, 1],
      [9, 1],
      [120, 30],
      [0, 10],
    ]);

    expect(state.cycles).toHaveLength(1);
    // The first 18 W tick: the machine woke there and never spent 120 s below
    // startWatts in one pause on the way to the drum.
    expect(state.cycles[0].startedAt).toBe("2026-09-14T08:05:30.000Z");
  });

  it("abandons a wake an unobserved stretch outlived", () => {
    // Awake-idle, then three hours with no samples at all — a host restart, or
    // the plug off-network. The wake belongs to a moment nobody observed, so it
    // cannot date a wash that starts after the gap, whether the machine is
    // washing when the samples resume or not.
    const awake = metres([
      [0, 5],
      [18, 1],
      [9, 1],
    ]);
    expect(awake.open?.wokeAt).toBe("2026-09-14T08:05:30.000Z");

    const state = recordWashingMachineSample(awake, {
      at: "2026-09-14T11:06:00.000Z",
      config: METERED_CONFIG,
      costPerKwh: 0.3,
      elapsedHours: 0,
      watts: 9,
    });

    expect(state.cycles).toEqual([]);
    expect(state.open?.wokeAt ?? null).toBeNull();

    // The same gap with the drum already turning when the ticks resume: the
    // wake is the first sample on the far side of the gap, never the one the
    // machine had before it.
    let washing = awake;
    for (const offset of [0, 30, 60, 90, 120]) {
      washing = recordWashingMachineSample(washing, {
        at: new Date(Date.parse("2026-09-14T11:06:00.000Z") + offset * 1000).toISOString(),
        config: METERED_CONFIG,
        costPerKwh: 0.3,
        elapsedHours: 30 / 3600,
        watts: 300,
      });
    }
    expect(washing.open?.startedAt).toBe("2026-09-14T11:06:00.000Z");
  });
});
