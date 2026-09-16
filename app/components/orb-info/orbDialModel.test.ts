import { describe, expect, it } from "vitest";
import { angleDelta, ORB_DIAL_INITIAL, orbDialDetentDeg, orbDialIndex, orbDialMarkAngle, orbDialNextDeadline, orbDialReducer } from "./orbDialModel";

const ids = ["a", "b", "c"];

describe("orb dial model", () => {
  it("steps one detent per entry and clamps at both ends", () => {
    let state = orbDialReducer(ORB_DIAL_INITIAL, { type: "open", now: 0 });
    state = orbDialReducer(state, { type: "step", delta: 1, ids, now: 100 });
    expect(state).toMatchObject({ open: true, shownId: "b", direction: 1 });
    state = orbDialReducer(state, { type: "step", delta: 5, ids, now: 200 });
    expect(orbDialIndex(state, ids)).toBe(2);
    state = orbDialReducer(state, { type: "step", delta: -9, ids, now: 300 });
    expect(state).toMatchObject({ shownId: null, direction: -1 });
  });
  it("defocuses after 5 s idle and reverts to the preferred order at once", () => {
    let state = orbDialReducer(orbDialReducer(ORB_DIAL_INITIAL, { type: "open", now: 0 }), { type: "step", delta: 2, ids, now: 1000 });
    expect(orbDialNextDeadline(state)).toBe(6000);
    state = orbDialReducer(state, { type: "tick", now: 5999 });
    expect(state).toMatchObject({ open: true, shownId: "c" });
    state = orbDialReducer(state, { type: "tick", now: 6000 });
    expect(state).toMatchObject({ open: false, shownId: null, direction: -1 });
    expect(orbDialNextDeadline(state)).toBeNull();
  });
  it("reverts on an explicit close too, not only on the idle tick", () => {
    const shown = orbDialReducer(orbDialReducer(ORB_DIAL_INITIAL, { type: "open", now: 0 }), { type: "step", delta: 1, ids, now: 10 });
    expect(orbDialReducer(shown, { type: "close" })).toMatchObject({ open: false, shownId: null, direction: -1 });
  });
  it("keeps the shown entry when the stack reorders, and falls back to the top when it vanishes", () => {
    const state = orbDialReducer(ORB_DIAL_INITIAL, { type: "step", delta: 1, ids, now: 0 });
    expect(orbDialIndex(state, ["alert", "a", "b", "c"])).toBe(2);
    expect(orbDialIndex(state, ["a", "c"])).toBe(0);
    expect(orbDialReducer(state, { type: "step", delta: 1, ids: ["alert", "a", "b", "c"], now: 1 }).shownId).toBe("c");
  });
  it("lays detents on the arc and measures signed sweeps", () => {
    expect(orbDialDetentDeg(2)).toBe(45);
    expect(orbDialDetentDeg(10)).toBe(30);
    expect([orbDialMarkAngle(0, 3), orbDialMarkAngle(2, 3)]).toEqual([-45, 45]);
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
  });
});
