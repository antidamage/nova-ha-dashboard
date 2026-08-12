import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardZone } from "./types";

// state.ts reaches Home Assistant and the registry at import time through its
// module graph; none of that is needed to exercise the transition marking.
vi.mock("./ha/client", () => ({ callService: vi.fn(), haRest: vi.fn(), subscribeHaStateChanges: vi.fn() }));

const { markLightingTransitions } = await import("./state");
const { claimLightingBrightnessTargets, resetLightingConvergenceForTest } = await import("./lighting-convergence");

function light(entityId: string, brightness: number, state = "on"): DashboardEntity {
  return {
    area_id: "lounge",
    attributes: { brightness },
    domain: "light",
    entity_id: entityId,
    name: entityId,
    state,
  } as unknown as DashboardEntity;
}

function zone(id: string, entities: DashboardEntity[]): DashboardZone {
  return { entities, id, name: id } as unknown as DashboardZone;
}

describe("marking in-flight lighting as transitional", () => {
  beforeEach(() => {
    resetLightingConvergenceForTest();
  });

  it("publishes the target for lights still travelling, and the zones holding them", () => {
    const lamp = light("light.lounge_lamp", 220);
    const shelf = light("light.lounge_shelf", 200);
    const entities = [lamp, shelf];
    // Both zones contain the same fixtures, as Home does over every room.
    const zones = [zone("everything", entities), zone("lounge", entities)];

    claimLightingBrightnessTargets([
      { entityId: "light.lounge_lamp", brightnessPct: 40 },
      { entityId: "light.lounge_shelf", brightnessPct: 40 },
    ]);
    markLightingTransitions(entities, zones);

    expect(lamp.brightnessTransition).toEqual({ targetPct: 40 });
    expect(shelf.brightnessTransition).toEqual({ targetPct: 40 });
    expect(zones[0].brightnessTransition).toEqual({ targetPct: 40 });
    expect(zones[1].brightnessTransition).toEqual({ targetPct: 40 });
  });

  it("makes a zone provisional when only one of its fixtures is still moving", () => {
    const slow = light("light.slow", 250);
    const arrived = light("light.arrived", 102);
    const entities = [slow, arrived];
    const zones = [zone("lounge", entities)];

    // Only the slow fixture still has an outstanding target; the other arrived
    // and was released by the convergence check.
    claimLightingBrightnessTargets([{ entityId: "light.slow", brightnessPct: 40 }]);
    markLightingTransitions(entities, zones);

    expect(arrived.brightnessTransition).toBeUndefined();
    expect(zones[0].brightnessTransition).toEqual({ targetPct: 40 });
  });

  it("does not mark a light that was turned off, or anything when nothing is in flight", () => {
    const off = light("light.off_now", 0, "off");
    const zones = [zone("lounge", [off])];

    claimLightingBrightnessTargets([{ entityId: "light.off_now", brightnessPct: 40 }]);
    markLightingTransitions([off], zones);
    expect(off.brightnessTransition).toBeUndefined();
    expect(zones[0].brightnessTransition).toBeUndefined();

    resetLightingConvergenceForTest();
    const steady = light("light.steady", 102);
    const steadyZones = [zone("lounge", [steady])];
    markLightingTransitions([steady], steadyZones);
    expect(steady.brightnessTransition).toBeUndefined();
    expect(steadyZones[0].brightnessTransition).toBeUndefined();
  });
});
