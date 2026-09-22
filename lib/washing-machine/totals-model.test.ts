import { describe, expect, it } from "vitest";
import { downsampleTrace, nextPerson } from "../washing-machine";

/**
 * The person cycle every claim and unclaim walks, and the sparkline that keeps a
 * wash's curve short. Both were covered by the attribution suite the wash's
 * timer replaced, and both are still live: `nextPerson` drives the tap that
 * claims a wash, and `downsampleTrace` every curve the power panel draws.
 */
describe("the person cycle", () => {
  const people = ["addie", "tonya", "mika"];

  it("walks unassigned through every person and back to unassigned", () => {
    let person: string | null = null;
    const seen: Array<string | null> = [];
    for (let tap = 0; tap < 4; tap += 1) {
      person = nextPerson(person, people);
      seen.push(person);
    }

    expect(seen).toEqual(["addie", "tonya", "mika", null]);
  });

  it("stays unassigned when the household has configured nobody", () => {
    expect(nextPerson(null, [])).toBeNull();
    expect(nextPerson("addie", [])).toBeNull();
  });

  it("returns to unassigned for a person who has left config", () => {
    // The cycle is built from config order, so an id nobody recognises has no
    // place in it: the wash goes unassigned rather than to a guessed name.
    expect(nextPerson("departed", people)).toBeNull();
  });
});

describe("downsampleTrace", () => {
  /** 96 points, so 48 buckets divide it exactly and the means are exact. */
  const trace = Array.from({ length: 96 }, (_, index) => [index * 10, index] as [number, number]);

  it("keeps a short trace as it is, in watts", () => {
    expect(downsampleTrace([[0, 100], [30, 200]])).toEqual([100, 200]);
  });

  it("averages a long one down to 48 points", () => {
    const curve = downsampleTrace(trace);

    expect(curve).toHaveLength(48);
    expect(curve[0]).toBe(0.5);
    expect(curve[47]).toBe(94.5);
  });

  it("takes the count it is given", () => {
    expect(downsampleTrace(trace, 5)).toHaveLength(5);
  });
});
