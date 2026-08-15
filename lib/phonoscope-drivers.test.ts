import { describe, expect, it } from "vitest";
import {
  createPhonoscopeDriverStates,
  driverFiresOn,
  driverPeriodSeconds,
  evaluatePhonoscopeDriverLanes,
  mergePhonoscopeSettingsGroups,
  phonoscopeDriver,
  seedFraction,
  stablePhonoscopeSeed,
  type PhonoscopeEffectDeclaration,
  type PhonoscopeSignalFrame,
} from "./phonoscope-drivers";
import {
  isPhonoscopeOverrideOnlyEffect,
  phonoscopeTransitionRamp,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
} from "./phonoscope-drivers";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "./types";

const GLOW: PhonoscopeEffectDeclaration = {
  id: "glow", min: 0, max: 10, step: 0.1, default: 0,
};
const declarations = new Map([[GLOW.id, GLOW]]);

function frameAt(partial: Partial<PhonoscopeSignalFrame> = {}): PhonoscopeSignalFrame {
  return {
    time: 0,
    delta: 1 / 60,
    beatIndex: 0,
    barIndex: 0,
    beatPhase: 0,
    barPhase: 0,
    beatPulse: 0,
    downbeatPulse: 0,
    energy: 0,
    spectrum: new Array(32).fill(0),
    beatsPerBar: 4,
    secondsPerBeat: 0.5,
    trackSeed: 1,
    ...partial,
  };
}

function lane(
  id: string,
  driver: PhonoscopeDriverLane["driver"],
  bindings: PhonoscopeEffectBinding[],
  modifiers: PhonoscopeDriverLane["modifiers"] = [],
): PhonoscopeDriverLane {
  return { id, driver, modifiers, bindings };
}

function binding(partial: Partial<PhonoscopeEffectBinding> = {}): PhonoscopeEffectBinding {
  return { id: "b1", effect: "glow", ...partial };
}

/** Step a frame sequence through the evaluator, returning the value each tick. */
function run(
  lanes: { groupId: string; lane: PhonoscopeDriverLane }[],
  frames: PhonoscopeSignalFrame[],
  combine: Record<string, PhonoscopeCombineMode> = {},
) {
  const states = createPhonoscopeDriverStates();
  return frames.map((frame) =>
    evaluatePhonoscopeDriverLanes({ lanes, combine, declarations, frame, states }).values.glow);
}

describe("driverFiresOn", () => {
  it("fires on every event when the cycle is one", () => {
    expect([0, 1, 2, 3].map((index) => driverFiresOn(index, 1, 0))).toEqual([true, true, true, true]);
  });

  it("fires on every Nth event", () => {
    expect([0, 1, 2, 3, 4].map((index) => driverFiresOn(index, 2, 0)))
      .toEqual([true, false, true, false, true]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => driverFiresOn(index, 4, 0)))
      .toEqual([true, false, false, false, true, false, false, false, true]);
  });

  it("offsets which event in the cycle fires", () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => driverFiresOn(index, 3, 1)))
      .toEqual([false, true, false, false, true, false]);
  });

  it("handles negative indices without falling off the cycle", () => {
    expect(driverFiresOn(-4, 4, 0)).toBe(true);
    expect(driverFiresOn(-3, 4, 0)).toBe(false);
  });
});

describe("stablePhonoscopeSeed", () => {
  // Mirrors nova::stableSeed. The basis is deliberately the engines' own
  // 1469598103934665603, not the canonical FNV-1a value.
  it("matches the engines' FNV-1a", () => {
    expect(stablePhonoscopeSeed("")).toBe(1469598103934665603n);
    expect(stablePhonoscopeSeed("a")).toBe(
      ((1469598103934665603n ^ 97n) * 1099511628211n) & ((1n << 64n) - 1n),
    );
  });

  it("resolves to a stable 0..1 fraction", () => {
    const fraction = seedFraction(stablePhonoscopeSeed("group:lane:binding:0:b:4"));
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThanOrEqual(1);
    expect(seedFraction(stablePhonoscopeSeed("group:lane:binding:0:b:4"))).toBe(fraction);
  });
});

describe("driverPeriodSeconds", () => {
  const frame = frameAt();

  it("ranks rarer drivers higher", () => {
    const beat = driverPeriodSeconds(phonoscopeDriver({ type: "beat" }), frame);
    const downbeat = driverPeriodSeconds(phonoscopeDriver({ type: "downbeat" }), frame);
    const fourthDownbeat = driverPeriodSeconds(
      phonoscopeDriver({ type: "downbeat", every: 4 }), frame);
    const song = driverPeriodSeconds(phonoscopeDriver({ type: "song" }), frame);
    expect(beat).toBeLessThan(downbeat);
    expect(downbeat).toBeLessThan(fourthDownbeat);
    expect(fourthDownbeat).toBeLessThan(song);
  });

  it("ranks a subdivided lane as commoner than the pulse it divides", () => {
    const beat = driverPeriodSeconds(phonoscopeDriver({ type: "beat" }), frame);
    const half = driverPeriodSeconds(phonoscopeDriver({ type: "beat", divide: 2 }), frame);
    const eighth = driverPeriodSeconds(phonoscopeDriver({ type: "beat", divide: 8 }), frame);
    expect(half).toBeCloseTo(beat / 2, 10);
    expect(eighth).toBeCloseTo(beat / 8, 10);
    const bar = driverPeriodSeconds(phonoscopeDriver({ type: "downbeat" }), frame);
    expect(driverPeriodSeconds(phonoscopeDriver({ type: "downbeat", divide: 4 }), frame))
      .toBeCloseTo(bar / 4, 10);
  });

  it("gives continuous drivers no rarity at all", () => {
    for (const type of ["energy", "bass", "mid", "treble"] as const) {
      expect(driverPeriodSeconds(phonoscopeDriver({ type }), frame)).toBe(0);
    }
  });

  it("ranks a random driver by the window it fires once inside", () => {
    // Random fires exactly once per window, so it is exactly as rare as the
    // cadence it borrows -- and therefore rankable, where the old
    // sample-and-hold random was excluded from `strongest` and `common` alike.
    for (const cadence of ["beat", "downbeat"] as const) {
      expect(driverPeriodSeconds(phonoscopeDriver({ type: "random", cadence }), frame))
        .toBe(driverPeriodSeconds(phonoscopeDriver({ type: cadence }), frame));
    }
    expect(driverPeriodSeconds(
      phonoscopeDriver({ type: "random", cadence: "downbeat", every: 4 }), frame,
    )).toBe(driverPeriodSeconds(phonoscopeDriver({ type: "downbeat", every: 4 }), frame));
    expect(driverPeriodSeconds(phonoscopeDriver({ type: "random", cadence: "song" }), frame))
      .toBe(Number.POSITIVE_INFINITY);
  });
});

describe("pulse envelopes", () => {
  it("attacks, holds and releases on a beat", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }), [binding({
        min: 0, max: 10, attackSeconds: 0.1, holdSeconds: 0.1, releaseSeconds: 0.2,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (time: number, beatIndex: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time, delta: 0.05, beatIndex }),
      }).values.glow;

    expect(at(0, 0)).toBeCloseTo(5, 5);     // half way up a 0.1s attack
    expect(at(0.05, 0)).toBeCloseTo(10, 5); // attack complete
    expect(at(0.1, 0)).toBeCloseTo(10, 5);  // holding
    expect(at(0.15, 0)).toBeCloseTo(10, 5); // hold expires at the end of this tick
    expect(at(0.2, 0)).toBeCloseTo(7.5, 5); // releasing over 0.2s
    expect(at(0.25, 0)).toBeCloseTo(5, 5);
    expect(at(0.3, 0)).toBeCloseTo(2.5, 5);
    expect(at(0.35, 0)).toBeCloseTo(0, 5);
    expect(at(0.4, 0)).toBeCloseTo(0, 5);   // stays idle until the next event
  });

  it("retriggers from the current level rather than clicking back to zero", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }), [binding({
        min: 0, max: 10, attackSeconds: 0.1, holdSeconds: 0, releaseSeconds: 1,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (time: number, beatIndex: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time, delta: 0.05, beatIndex }),
      }).values.glow;

    at(0, 0);
    at(0.05, 0);
    const released = at(0.1, 0);
    expect(released).toBeLessThan(10);
    // A new beat mid-release resumes the attack from where it had fallen to,
    // so the level never drops on a retrigger.
    expect(at(0.15, 1)).toBeGreaterThan(released);
  });

  it("only fires on qualifying events when every is set", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "downbeat", every: 4 }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (barIndex: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time: barIndex, delta: 0.05, barIndex }),
      }).values.glow;

    expect(at(0)).toBe(10);
    expect(at(1)).toBe(0);
    expect(at(2)).toBe(0);
    expect(at(3)).toBe(0);
    expect(at(4)).toBe(10);
  });

  it("fires four times a beat when the beat is quartered", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat", divide: 4 }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (beatIndex: number, beatPhase: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time: beatIndex + beatPhase, delta: 0.05, beatIndex, beatPhase }),
      }).values.glow;

    // One firing per quarter of the beat: the second sample inside a quarter is
    // the same event, so the envelope has already fallen back to nothing.
    expect(at(0, 0)).toBe(10);
    expect(at(0, 0.1)).toBe(0);
    expect(at(0, 0.25)).toBe(10);
    expect(at(0, 0.4)).toBe(0);
    expect(at(0, 0.5)).toBe(10);
    expect(at(0, 0.75)).toBe(10);
    expect(at(1, 0)).toBe(10);
  });

  it("subdivides the bar for a quartered downbeat", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "downbeat", divide: 2 }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (barIndex: number, barPhase: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time: barIndex + barPhase, delta: 0.05, barIndex, barPhase }),
      }).values.glow;

    expect(at(0, 0)).toBe(10);
    expect(at(0, 0.25)).toBe(0);
    expect(at(0, 0.5)).toBe(10);
    expect(at(0, 0.75)).toBe(0);
    expect(at(1, 0)).toBe(10);
  });

  it("leaves an undivided driver's events exactly as they were", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (beatIndex: number, beatPhase: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ time: beatIndex + beatPhase, delta: 0.05, beatIndex, beatPhase }),
      }).values.glow;

    expect(at(0, 0)).toBe(10);
    expect(at(0, 0.5)).toBe(0);
    expect(at(0, 0.75)).toBe(0);
    expect(at(1, 0)).toBe(10);
  });
});

describe("phonoscopeDriver", () => {
  it("keeps counting and subdividing exclusive", () => {
    const driver = phonoscopeDriver({ type: "beat", divide: 4, every: 8, offset: 3 });
    expect(driver.divide).toBe(4);
    expect(driver.every).toBe(1);
    expect(driver.offset).toBe(0);
  });

  it("drops a subdivision the pulse cannot carry", () => {
    expect(phonoscopeDriver({ type: "song", divide: 4 }).divide).toBe(1);
    expect(phonoscopeDriver({ type: "timer", divide: 4 }).divide).toBe(1);
    expect(phonoscopeDriver({ type: "random", cadence: "song", divide: 4 }).divide).toBe(1);
    expect(phonoscopeDriver({ type: "random", cadence: "downbeat", divide: 4 }).divide).toBe(4);
  });

  it("reads an unsupported subdivision as the whole pulse", () => {
    expect(phonoscopeDriver({ type: "beat", divide: 3 }).divide).toBe(1);
    expect(phonoscopeDriver({ type: "beat", divide: 0 }).divide).toBe(1);
  });
});

describe("continuous drivers", () => {
  it("follows the band level with the envelope as a rate limit", () => {
    const spectrum = new Array(32).fill(0);
    spectrum[0] = 1;
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "bass" }), [binding({
        min: 0, max: 10, attackSeconds: 0.1, holdSeconds: 0, releaseSeconds: 0.1,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (bass: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states,
        frame: frameAt({ delta: 0.05, spectrum: [bass, ...new Array(31).fill(0)] }),
      }).values.glow;

    expect(at(1)).toBeCloseTo(5, 5);
    expect(at(1)).toBeCloseTo(10, 5);
    expect(at(0)).toBeCloseTo(5, 5);
    expect(at(0)).toBeCloseTo(0, 5);
  });

  it("reads bass, mid and treble from their own bands", () => {
    const spectrum = new Array(32).fill(0);
    spectrum[25] = 0.5;
    const build = (type: "bass" | "mid" | "treble") => [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type }), [binding({
        min: 0, max: 10, attackSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const frame = frameAt({ spectrum });
    expect(run(build("bass"), [frame])[0]).toBe(0);
    expect(run(build("mid"), [frame])[0]).toBe(0);
    expect(run(build("treble"), [frame])[0]).toBeCloseTo(5, 5);
  });
});

describe("modifiers", () => {
  it("adds the modifier signal onto the main driver", () => {
    const spectrum = new Array(32).fill(0);
    spectrum[0] = 0.5;
    const lanes = [{
      groupId: "g",
      lane: lane(
        "l",
        phonoscopeDriver({ type: "downbeat" }),
        [binding({ min: 0, max: 10, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0 })],
        [phonoscopeDriver({ type: "bass" })],
      ),
    }];
    // Downbeat contributes a full 1 and bass contributes 0.5, so the pair
    // overshoots the authored maximum — which is deliberate.
    const value = run(lanes, [frameAt({ spectrum, delta: 0.05 })])[0];
    expect(value).toBeCloseTo(15, 5);
  });
});

describe("combining several lanes on one effect", () => {
  const spectrum = new Array(32).fill(0);
  const beatLane = {
    groupId: "g",
    lane: lane("beat", phonoscopeDriver({ type: "beat" }), [binding({
      id: "b-beat", min: 0, max: 4, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
    })]),
  };
  const downbeatLane = {
    groupId: "g",
    lane: lane("down", phonoscopeDriver({ type: "downbeat", every: 4 }), [binding({
      id: "b-down", min: 0, max: 10, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
    })]),
  };

  it("sums contributions when the effect combines by add", () => {
    const value = run([beatLane, downbeatLane], [frameAt({ spectrum, delta: 0.05 })], {
      glow: "add",
    })[0];
    expect(value).toBeCloseTo(14, 5);
  });

  it("lets the rarest firing lane win outright when combining by strongest", () => {
    const value = run([beatLane, downbeatLane], [frameAt({ spectrum, delta: 0.05 })], {
      glow: "strongest",
    })[0];
    expect(value).toBeCloseTo(10, 5);
  });

  it("falls back to the frequent lane when the rare one is silent", () => {
    // Bar 1 is not a multiple of four, so only the beat lane fires.
    const value = run([beatLane, downbeatLane], [frameAt({
      spectrum, delta: 0.05, barIndex: 1, beatIndex: 4,
    })], { glow: "strongest" })[0];
    expect(value).toBeCloseTo(4, 5);
  });

  it("lets the busiest firing lane win outright when combining by common", () => {
    // The mirror of `strongest`: the beat lane fires four times as often as the
    // every-fourth-downbeat one, so it is the one that takes the effect.
    const value = run([beatLane, downbeatLane], [frameAt({ spectrum, delta: 0.05 })], {
      glow: "common",
    })[0];
    expect(value).toBeCloseTo(4, 5);
  });

  it("does not let a level lane win `common`, which has no period at all", () => {
    const levelLane = {
      groupId: "g",
      lane: lane("energy", phonoscopeDriver({ type: "energy" }), [binding({
        id: "b-energy", min: 0, max: 2, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    };
    // Energy is continuous, so it is "most frequent" in a sense that would make
    // every pulse unhearable. The downbeat still takes it.
    const value = run([levelLane, downbeatLane], [frameAt({
      spectrum, delta: 0.05, energy: 1,
    })], { glow: "common" })[0];
    expect(value).toBeCloseTo(10, 5);
  });

  it("replaces rather than stacks when combining by override, resting value and all", () => {
    const lanes = [
      {
        groupId: "defaults",
        lane: lane("a", phonoscopeDriver({ type: "downbeat", every: 8 }), [binding({
          id: "b-a", min: 3, max: 5, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
        })]),
      },
      {
        groupId: "override",
        lane: lane("b", phonoscopeDriver({ type: "beat" }), [binding({
          id: "b-b", min: 1, max: 2, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
        })]),
      },
    ];
    // The later group wins outright: 1 (its own resting) + 1 (its contribution).
    // Under `add` the shared floor would be the earlier group's 3 and the total
    // would be 5, which is exactly what an override must NOT do.
    expect(run(lanes, [frameAt({ spectrum, delta: 0.05 })], { glow: "override" })[0])
      .toBeCloseTo(2, 5);
    expect(run(lanes, [frameAt({ spectrum, delta: 0.05 })], { glow: "add" })[0])
      .toBeCloseTo(6, 5);
  });

  it("forces override on the transition axes whatever the group stored", () => {
    const transition: PhonoscopeEffectDeclaration = {
      id: PHONOSCOPE_CENTRE_TRANSITION_EFFECT, min: 0, max: 2, step: 1, default: 0,
    };
    const pinned = (id: string, value: number) => ({
      groupId: id,
      lane: lane(id, phonoscopeDriver({ type: "beat" }), [{
        id: `${id}_bind`,
        effect: PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
        min: value,
        max: value,
        attackSeconds: 0,
        holdSeconds: 1,
        releaseSeconds: 0,
      }]),
    });
    const result = evaluatePhonoscopeDriverLanes({
      lanes: [pinned("defaults", 1), pinned("override", 2)],
      // Deliberately the mode that would sum them to 3 — off the end of the axis.
      combine: { [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: "add" },
      declarations: new Map([[transition.id, transition]]),
      frame: frameAt({ spectrum, delta: 0.05 }),
      states: createPhonoscopeDriverStates(),
    });
    expect(result.values[PHONOSCOPE_CENTRE_TRANSITION_EFFECT]).toBe(2);
    expect(isPhonoscopeOverrideOnlyEffect(PHONOSCOPE_CENTRE_TRANSITION_EFFECT)).toBe(true);
    expect(isPhonoscopeOverrideOnlyEffect("glow")).toBe(false);
  });

  it("does not double the resting floor when two bindings share an effect", () => {
    const restingLanes = [
      {
        groupId: "g",
        lane: lane("a", phonoscopeDriver({ type: "downbeat", every: 8 }), [binding({
          id: "b-a", min: 3, max: 5, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
        })]),
      },
      {
        groupId: "g",
        lane: lane("b", phonoscopeDriver({ type: "downbeat", every: 16 }), [binding({
          id: "b-b", min: 2, max: 6, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
        })]),
      },
    ];
    // Bar 1 is a multiple of neither cycle, so nothing is firing: the value
    // rests at the highest authored minimum, not the sum of both minimums.
    const idle = run(restingLanes, [frameAt({ spectrum, delta: 0.05, beatIndex: 4, barIndex: 1 })], {
      glow: "add",
    })[0];
    expect(idle).toBeCloseTo(3, 5);
  });

  it("behaves exactly like a single parameter source when only one lane drives", () => {
    const single = [{
      groupId: "g",
      lane: lane("only", phonoscopeDriver({ type: "beat" }), [binding({
        min: 2, max: 7, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
      })]),
    }];
    expect(run(single, [frameAt({ spectrum, delta: 0.05 })])[0]).toBeCloseTo(7, 5);
  });
});

describe("overshoot guard", () => {
  it("allows overshoot but keeps the value finite", () => {
    const lanes = Array.from({ length: 8 }, (_unused, index) => ({
      groupId: "g",
      lane: lane(`l${index}`, phonoscopeDriver({ type: "beat" }), [binding({
        id: `b${index}`, min: 0, max: 10, attackSeconds: 0, holdSeconds: 1, releaseSeconds: 0,
      })]),
    }));
    const value = run(lanes, [frameAt({ delta: 0.05 })], { glow: "add" })[0];
    // Eight lanes would reach 80; the guard caps at four full ranges above rest.
    expect(value).toBeCloseTo(40, 5);
  });
});

describe("timer and song drivers", () => {
  it("fires the timer on its interval", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "timer", intervalSeconds: 1 }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (time: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states, frame: frameAt({ time, delta: 0.5 }),
      }).values.glow;

    expect(at(0)).toBe(10);
    expect(at(0.5)).toBe(0);
    expect(at(1)).toBe(10);
    expect(at(1.5)).toBe(0);
    expect(at(2)).toBe(10);
  });

  it("fires the song driver on a track change, not on the first frame of a track", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "song" }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (trackSeed: number, time: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states, frame: frameAt({ trackSeed, time, delta: 0.5 }),
      }).values.glow;

    // Event 0 is the track already playing when the lane starts.
    expect(at(11, 0)).toBe(10);
    expect(at(11, 0.5)).toBe(0);
    expect(at(22, 1)).toBe(10);
    expect(at(22, 1.5)).toBe(0);
  });

  it("counts song events so every applies to them too", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "song", every: 2 }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
      })]),
    }];
    const states = createPhonoscopeDriverStates();
    const at = (trackSeed: number, time: number) =>
      evaluatePhonoscopeDriverLanes({
        lanes, combine: {}, declarations, states, frame: frameAt({ trackSeed, time, delta: 0.5 }),
      }).values.glow;

    expect(at(1, 0)).toBe(10);   // song 0
    expect(at(2, 1)).toBe(0);    // song 1, skipped
    expect(at(3, 2)).toBe(10);   // song 2
  });
});

describe("random drivers", () => {
  /** A binding that reads as a single tick at full value on each fire. */
  const instant = (partial: Partial<PhonoscopeEffectBinding> = {}) => binding({
    min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0, ...partial,
  });

  it("fires once per window, at the seeded point inside it", () => {
    const build = () => [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "random", cadence: "beat" }), [instant()]),
    }];
    // Window 0's threshold is 0.651022 and window 1's is 0.321335, so the fire
    // lands in the last quarter of beat 0 and the third quarter of beat 1 --
    // a different point each time, which is the whole point.
    const frames = [0, 0.25, 0.5, 0.75].flatMap((beatPhase) => [0, 1].map((beatIndex) =>
      ({ beatIndex, beatPhase })))
      .sort((a, b) => (a.beatIndex - b.beatIndex) || (a.beatPhase - b.beatPhase))
      .map(({ beatIndex, beatPhase }) => frameAt({
        beatIndex, beatPhase, time: (beatIndex + beatPhase) * 0.5, delta: 0.125,
      }));

    const first = run(build(), frames);
    expect(first).toEqual([0, 0, 0, 10, 0, 0, 10, 0]);
    // Same seed, same jitter: the engines must agree frame for frame.
    expect(run(build(), frames)).toEqual(first);
  });

  it("spreads one fire across the whole every-N window, not inside the Nth bar", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({
        type: "random", cadence: "downbeat", every: 4,
      }), [instant()]),
    }];
    // Window 0 spans bars 0-3 with threshold 0.632706, so it fires partway
    // through bar 2. Were `every` selecting which bar to jitter inside, nothing
    // could fire before bar 3.
    const frames = [
      { barIndex: 0, barPhase: 0 }, { barIndex: 1, barPhase: 0 },
      { barIndex: 2, barPhase: 0 }, { barIndex: 2, barPhase: 0.75 },
      { barIndex: 3, barPhase: 0 }, { barIndex: 4, barPhase: 0 },
      { barIndex: 5, barPhase: 0 }, { barIndex: 6, barPhase: 0 },
    ].map(({ barIndex, barPhase }) => frameAt({
      barIndex, barPhase, time: (barIndex + barPhase) * 2, delta: 0.5,
    }));

    expect(run(lanes, frames)).toEqual([0, 0, 0, 10, 0, 0, 0, 10]);
  });

  it("runs the binding envelope rather than gliding past it", () => {
    // A release the driver cannot override: the old sample-and-hold random
    // ignored the envelope entirely, so this decay is the visible difference.
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "random", cadence: "beat" }), [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 1,
      })]),
    }];
    const frames = [0.5, 0.75, 1].map((beatPhase) => frameAt({
      beatIndex: 0, beatPhase, time: beatPhase * 0.5, delta: 0.25,
    }));
    const values = run(lanes, frames);
    expect(values[0]).toBe(0);          // before the 0.651022 threshold
    expect(values[1]).toBe(10);         // the fire
    expect(values[2]).toBeCloseTo(7.5, 6); // 0.25s into a 1s release
  });

  it("falls back to the track change when the cadence is song", () => {
    // A song has no known length, so there is no interior to jitter within.
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "random", cadence: "song" }), [instant()]),
    }];
    const frames = [1, 1, 2].map((trackSeed, index) =>
      frameAt({ trackSeed, time: index * 0.5, delta: 0.5 }));
    expect(run(lanes, frames)).toEqual([10, 0, 10]);
  });
});

describe("randomValue bindings", () => {
  const instant = (partial: Partial<PhonoscopeEffectBinding> = {}) => binding({
    min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0, ...partial,
  });

  it("draws a new target inside the range on each lane event", () => {
    const build = () => [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }), [instant({ randomValue: true })]),
    }];
    const frames = [
      frameAt({ beatIndex: 0, delta: 0.25 }),
      frameAt({ beatIndex: 0, beatPhase: 0.5, time: 0.25, delta: 0.25 }),
      frameAt({ beatIndex: 1, time: 0.5, delta: 0.25 }),
      frameAt({ beatIndex: 2, time: 1, delta: 0.25 }),
    ];
    const values = run(build(), frames);
    // Pinned so the FNV-1a seed path stays identical across all three engines.
    // Changing them means re-recording tests/conformance/parameter-drivers.
    expect(values[0]).toBeCloseTo(0.8712282575, 8);   // roll on b:0
    expect(values[1]).toBe(0);                        // released; nothing to scale
    expect(values[2]).toBeCloseTo(7.5743748513, 8);   // a new roll on b:1
    expect(values[3]).toBeCloseTo(4.2775114450, 8);   // and again on b:2
    expect(run(build(), frames)).toEqual(values);
  });

  it("never leaves the authored range", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }),
        [instant({ min: 4, max: 6, randomValue: true })]),
    }];
    const frames = Array.from({ length: 12 }, (unused, index) => frameAt({
      beatIndex: index, time: index * 0.5, delta: 0.5,
    }));
    for (const value of run(lanes, frames)) {
      expect(value).toBeGreaterThanOrEqual(4);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it("agrees with the C++ and Swift engines value for value", () => {
    // These numbers were printed by the Swift evaluator on indium and by the
    // C++ one on voiceHost, from this exact frame sequence. The corpus digest
    // proves those two agree with each other; this is what ties the TypeScript
    // reference to them, because it is the one engine the corpus never runs.
    const frames = Array.from({ length: 8 }, (unused, tick) => frameAt({
      time: tick * 0.125,
      delta: 0.125,
      beatIndex: Math.floor(tick / 4),
      barIndex: Math.floor(tick / 4),
      beatPhase: (tick % 4) / 4,
      barPhase: (tick % 4) / 4,
    }));
    const sweep = (driver: PhonoscopeDriverLane["driver"], randomValue: boolean) => run([{
      groupId: "g",
      lane: lane("l", driver, [binding({
        min: 0, max: 10, attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0,
        ...(randomValue ? { randomValue: true } : {}),
      })]),
    }], frames);

    const round = (values: number[]) => values.map((value) => Number(value.toFixed(6)));
    expect(round(sweep(phonoscopeDriver({ type: "random", cadence: "beat" }), false)))
      .toEqual([0, 0, 0, 10, 0, 0, 10, 0]);
    // Every 4th downbeat is a four-bar window, and eight ticks only reach bar 1,
    // so nothing has fired yet. Under the old reading of `every` this lane could
    // not have fired here either -- but for the opposite reason.
    expect(round(sweep(
      phonoscopeDriver({ type: "random", cadence: "downbeat", every: 4 }), false,
    ))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(round(sweep(phonoscopeDriver({ type: "beat" }), true)))
      .toEqual([0.871228, 0, 0, 0, 7.574375, 0, 0, 0]);
    // Both halves at once: the jittered moments of the first, the drawn heights
    // of the third.
    expect(round(sweep(phonoscopeDriver({ type: "random", cadence: "beat" }), true)))
      .toEqual([0, 0, 0, 6.054888, 0, 0, 6.272557, 0]);
  });

  it("stacks with random timing: a random peak at a random moment", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "random", cadence: "beat" }),
        [instant({ randomValue: true })]),
    }];
    const frames = [0, 0.25, 0.5, 0.75].map((beatPhase) => frameAt({
      beatIndex: 0, beatPhase, time: beatPhase * 0.5, delta: 0.125,
    }));
    const values = run(lanes, frames);
    // Fires once, in the last quarter as before, but no longer at full range.
    expect(values.slice(0, 3)).toEqual([0, 0, 0]);
    expect(values[3]).toBeGreaterThan(0);
    expect(values[3]).toBeLessThan(10);
  });
});

describe("phonoscopeTransitionRamp", () => {
  it("finishes at exactly attack + hold + release", () => {
    expect(phonoscopeTransitionRamp(0, 0.5, 1, 0.5)).toBe(0);
    expect(phonoscopeTransitionRamp(1.999, 0.5, 1, 0.5)).toBeLessThan(1);
    expect(phonoscopeTransitionRamp(2, 0.5, 1, 0.5)).toBe(1);
    expect(phonoscopeTransitionRamp(9, 0.5, 1, 0.5)).toBe(1);
  });

  it("is symmetric about the midpoint when the two ramps match", () => {
    // Half the distance covered in half the time: an ease-in and an ease-out of
    // equal length cancel, which is what makes the control read as balanced.
    expect(phonoscopeTransitionRamp(1, 0.5, 1, 0.5)).toBeCloseTo(0.5, 10);
    expect(phonoscopeTransitionRamp(0.25, 1, 0, 1)).toBeCloseTo(
      1 - phonoscopeTransitionRamp(1.75, 1, 0, 1), 10);
  });

  it("accelerates through the attack and decelerates through the release", () => {
    // Equal time slices cover increasing distance while easing in, and
    // decreasing distance while easing out.
    const at = (t: number) => phonoscopeTransitionRamp(t, 1, 0, 1);
    const easingIn = [0.25, 0.5, 0.75, 1].map((t) => at(t) - at(t - 0.25));
    expect(easingIn[1]).toBeGreaterThan(easingIn[0]);
    expect(easingIn[3]).toBeGreaterThan(easingIn[2]);
    const easingOut = [1.25, 1.5, 1.75, 2].map((t) => at(t) - at(t - 0.25));
    expect(easingOut[1]).toBeLessThan(easingOut[0]);
    expect(easingOut[3]).toBeLessThan(easingOut[2]);
  });

  it("holds a constant velocity through the middle", () => {
    const at = (t: number) => phonoscopeTransitionRamp(t, 1, 2, 1);
    expect(at(2) - at(1.5)).toBeCloseTo(at(2.5) - at(2), 10);
  });

  it("degenerates safely: a bare release is a pure ease-out, and no ramp is a cut", () => {
    expect(phonoscopeTransitionRamp(0, 0, 0, 0)).toBe(1);
    expect(phonoscopeTransitionRamp(1, 0, 0, 2)).toBeGreaterThan(0.5);
    expect(phonoscopeTransitionRamp(2, 0, 0, 2)).toBe(1);
    // A bare attack is the opposite: everything is deferred to the end.
    expect(phonoscopeTransitionRamp(1, 2, 0, 0)).toBeLessThan(0.5);
    expect(phonoscopeTransitionRamp(2, 2, 0, 0)).toBe(1);
  });

  it("never leaves 0..1, whatever it is handed", () => {
    for (const t of [-5, 0, 0.3, 1.2, 50, Number.NaN]) {
      const value = phonoscopeTransitionRamp(t, 0.4, 0.2, 0.9);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("mergePhonoscopeSettingsGroups", () => {
  const group = (
    id: string,
    lanes: PhonoscopeDriverLane[],
    combine: Record<string, PhonoscopeCombineMode>,
    staticSettings: Record<string, number>,
  ): PhonoscopeSettingsGroup => ({
    id, name: id, moduleId: "particle-ripples", lanes, combine, staticSettings, isDefault: false,
  });

  it("stacks lanes and layers scalars, with the later group winning", () => {
    const base = group("base", [lane("a", phonoscopeDriver(), [binding()])],
      { glow: "add" }, { complexity: 0.4 });
    const hard = group("hard", [lane("b", phonoscopeDriver(), [binding({ id: "b2" })])],
      { glow: "strongest" }, { complexity: 0.9 });

    const merged = mergePhonoscopeSettingsGroups([base, hard]);
    expect(merged.lanes.map((entry) => `${entry.groupId}:${entry.lane.id}`))
      .toEqual(["base:a", "hard:b"]);
    expect(merged.combine.glow).toBe("strongest");
    expect(merged.staticSettings.complexity).toBe(0.9);
  });

  it("keeps a scalar the later group does not set", () => {
    const base = group("base", [], { glow: "strongest" }, { complexity: 0.4 });
    const hard = group("hard", [], {}, {});
    const merged = mergePhonoscopeSettingsGroups([base, hard]);
    expect(merged.combine.glow).toBe("strongest");
    expect(merged.staticSettings.complexity).toBe(0.4);
  });
});

describe("unknown effects", () => {
  it("ignores bindings whose effect the active module does not declare", () => {
    const lanes = [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({ type: "beat" }), [
        binding({ id: "known", effect: "glow", min: 0, max: 10, attackSeconds: 0, holdSeconds: 1 }),
        binding({ id: "unknown", effect: "not_declared", min: 0, max: 10 }),
      ]),
    }];
    const result = evaluatePhonoscopeDriverLanes({
      lanes, combine: {}, declarations, states: createPhonoscopeDriverStates(),
      frame: frameAt({ delta: 0.05 }),
    });
    expect(Object.keys(result.values)).toEqual(["glow"]);
    expect(result.driven.has("not_declared")).toBe(false);
  });
});
