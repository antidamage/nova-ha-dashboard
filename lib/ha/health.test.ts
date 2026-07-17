import { beforeEach, describe, expect, it } from "vitest";
import { reconcileHaStates, resetHaHealthMemory } from "./health";
import type { HaState } from "../types";

function light(id: string, state: string): HaState {
  return { entity_id: `light.${id}`, state, attributes: {} };
}

function healthySet(): HaState[] {
  return [
    light("a", "on"),
    light("b", "off"),
    light("c", "on"),
    light("d", "off"),
    light("e", "on"),
    light("f", "off"),
  ];
}

function allDead(states: HaState[]): HaState[] {
  return states.map((s) => ({ ...s, state: "unavailable" }));
}

describe("reconcileHaStates", () => {
  beforeEach(() => resetHaHealthMemory());

  it("passes a healthy snapshot through untouched", () => {
    const fresh = healthySet();
    const { states, health } = reconcileHaStates(fresh);
    expect(health.status).toBe("ok");
    expect(states).toEqual(fresh);
  });

  it("holds last-known-good when the whole snapshot goes unavailable at once", () => {
    reconcileHaStates(healthySet()); // seed memory
    const { states, health } = reconcileHaStates(allDead(healthySet()));
    expect(health.status).toBe("degraded");
    expect(health.reason).toBe("mass-unavailable");
    // Every previously-on light keeps its "on" value instead of flipping dead.
    expect(states.find((s) => s.entity_id === "light.a")?.state).toBe("on");
    expect(states.some((s) => s.state === "unavailable")).toBe(false);
    expect(health.heldEntityCount).toBeGreaterThan(0);
  });

  it("treats an empty snapshot as degraded and restores the known entities", () => {
    reconcileHaStates(healthySet());
    const { states, health } = reconcileHaStates([]);
    expect(health.status).toBe("degraded");
    expect(states.length).toBe(healthySet().length);
  });

  it("does NOT hold when only a single device drops offline", () => {
    reconcileHaStates(healthySet());
    const fresh = healthySet();
    fresh[0] = { ...fresh[0], state: "unavailable" };
    const { states, health } = reconcileHaStates(fresh);
    expect(health.status).toBe("ok");
    expect(states.find((s) => s.entity_id === "light.a")?.state).toBe("unavailable");
  });

  it("recovers cleanly once HA returns a healthy snapshot", () => {
    reconcileHaStates(healthySet());
    reconcileHaStates(allDead(healthySet()));
    const recovered = healthySet();
    recovered[1] = { ...recovered[1], state: "on" }; // b now on
    const { states, health } = reconcileHaStates(recovered);
    expect(health.status).toBe("ok");
    expect(states.find((s) => s.entity_id === "light.b")?.state).toBe("on");
  });
});
