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
import type {
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
  combine: Record<string, "add" | "strongest"> = {},
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

  it("gives continuous drivers no rarity at all", () => {
    for (const type of ["energy", "bass", "mid", "treble", "random"] as const) {
      expect(driverPeriodSeconds(phonoscopeDriver({ type }), frame)).toBe(0);
    }
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
  it("holds a seeded value between cadence events and is reproducible", () => {
    const build = () => [{
      groupId: "g",
      lane: lane("l", phonoscopeDriver({
        type: "random", cadence: "beat", transitionSeconds: 0,
      }), [binding({ min: 0, max: 10 })]),
    }];
    const frames = [
      frameAt({ beatIndex: 0, delta: 0.05 }),
      frameAt({ beatIndex: 0, time: 0.05, delta: 0.05 }),
      frameAt({ beatIndex: 1, time: 0.5, delta: 0.05 }),
    ];
    const first = run(build(), frames);
    const second = run(build(), frames);
    expect(first).toEqual(second);
    expect(first[0]).toBe(first[1]);
    expect(first[2]).not.toBe(first[1]);
    // Pinned so the FNV-1a seed path stays identical across all three engines.
    // The C++ port produces these same values for the same slot keys; changing
    // them means re-recording tests/conformance/parameter-drivers.
    expect(first[0]).toBeCloseTo(9.280491, 6);
    expect(first[2]).toBeCloseTo(5.983628, 6);
  });
});

describe("mergePhonoscopeSettingsGroups", () => {
  const group = (
    id: string,
    lanes: PhonoscopeDriverLane[],
    combine: Record<string, "add" | "strongest">,
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
