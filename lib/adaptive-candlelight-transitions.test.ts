import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardEntity, DashboardState } from "./types";

const buildDashboardState = vi.fn<[], Promise<DashboardState>>();
const callService = vi.fn(async () => undefined);
const mergeDashboardPreferences = vi.fn(async () => undefined);

vi.mock("./state", () => ({
  buildDashboardState: () => buildDashboardState(),
}));

vi.mock("./ha/client", () => ({
  callService: (...args: unknown[]) => callService(...(args as [])),
  haRest: vi.fn(),
  subscribeHaStateChanges: vi.fn(),
}));

vi.mock("./preferences", () => ({
  mergeDashboardPreferences: (...args: unknown[]) => mergeDashboardPreferences(...(args as [])),
}));

const { applyAdaptiveCandlelightTransitions, setZoneAction } = await import("./ha");
const { resetLightingConvergenceForTest } = await import("./lighting-convergence");

function light(entityId: string, brightness: number, state = "on"): DashboardEntity {
  return {
    area_id: "lounge",
    attributes: { brightness, supported_color_modes: ["color_temp", "hs"] },
    domain: "light",
    entity_id: entityId,
    name: entityId,
    state,
  } as unknown as DashboardEntity;
}

/**
 * Live-shaped state: a room zone plus the aggregate "Home" zone over the same
 * light, both following adaptive candlelight, both still remembering last
 * night's sun state while the sun is now up.
 */
function stateWith(options: {
  brightness: number;
  lightState?: string;
  lastSunState?: "above_horizon" | "below_horizon";
}): DashboardState {
  const entity = light("light.lounge_lamp", options.brightness, options.lightState ?? "on");
  const zoneEntry = {
    enabled: true,
    lastSunState: options.lastSunState ?? "below_horizon",
    updatedAt: "2026-08-12T06:00:00.000Z",
  };

  return {
    entities: [entity],
    lighting: { entityPresets: [], intensityThresholds: [] },
    preferences: {
      lighting: {
        adaptiveCandlelightZones: { everything: { ...zoneEntry }, lounge: { ...zoneEntry } },
      },
    },
    sun: { entity_id: "sun.sun", state: "above_horizon" },
    zones: [
      { entities: [entity], id: "everything", name: "Home" },
      { entities: [entity], id: "lounge", name: "Lounge" },
    ],
  } as unknown as DashboardState;
}

function lightBrightnessCalls() {
  return callService.mock.calls
    .filter((call) => call[0] === "light" && call[1] === "turn_on")
    .map((call) => (call[2] as { brightness_pct?: number }).brightness_pct);
}

function stampedSunStates() {
  return mergeDashboardPreferences.mock.calls.flatMap((call) =>
    Object.entries(
      (call[0] as { lighting: { adaptiveCandlelightZones: Record<string, { lastSunState?: string }> } })
        .lighting.adaptiveCandlelightZones,
    ).map(([zoneId, entry]) => `${zoneId}:${entry.lastSunState ?? "none"}`),
  );
}

describe("adaptive candlelight transitions versus a brightness the user just set", () => {
  beforeEach(() => {
    buildDashboardState.mockReset();
    callService.mockClear();
    mergeDashboardPreferences.mockClear();
    resetLightingConvergenceForTest();
    vi.useFakeTimers();
  });

  it("transitions lights that were already on when the sun crossed the horizon", async () => {
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 153 }));

    await applyAdaptiveCandlelightTransitions();

    // Daytime adaptive brightness is full, which is the intended behaviour here:
    // these lights were on across the crossing and nobody has set them since.
    expect(lightBrightnessCalls()).toEqual([100]);
    expect(stampedSunStates()).toContain("everything:above_horizon");
  });

  it("settles a zone with nothing on instead of leaving the transition to ambush the next set", async () => {
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 0, lightState: "off" }));

    await applyAdaptiveCandlelightTransitions();

    expect(lightBrightnessCalls()).toEqual([]);
    expect(stampedSunStates()).toEqual(
      expect.arrayContaining(["everything:above_horizon", "lounge:above_horizon"]),
    );
  });

  it("leaves a brightness set after the crossing alone, including via the Home zone", async () => {
    // The user drags the lounge zone to 40% while both zones still remember
    // last night. Setting the brightness must consume the pending transition.
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 153 }));
    await setZoneAction({ zoneId: "lounge", action: "brightness", brightnessPct: 40 });

    expect(lightBrightnessCalls()).toEqual([40]);
    expect(stampedSunStates()).toEqual(
      expect.arrayContaining(["everything:above_horizon", "lounge:above_horizon"]),
    );

    // A minute later the scheduled pass runs against the state that resulted.
    callService.mockClear();
    buildDashboardState.mockResolvedValue(
      stateWith({ brightness: 102, lastSunState: "above_horizon" }),
    );
    await applyAdaptiveCandlelightTransitions();

    expect(lightBrightnessCalls()).toEqual([]);
  });

  it("re-drives a light that stopped short of the brightness it was sent to", async () => {
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 153 }));
    await setZoneAction({ zoneId: "lounge", action: "brightness", brightnessPct: 40 });
    expect(lightBrightnessCalls()).toEqual([40]);

    // The fade stalled well short of 40%: the follow-up sends it again.
    callService.mockClear();
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 179, lastSunState: "above_horizon" }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(lightBrightnessCalls()).toEqual([40]);

    // Once it has arrived (within device rounding) the follow-up stands down,
    // so this can never become a standing override.
    callService.mockClear();
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 102, lastSunState: "above_horizon" }));
    await vi.advanceTimersByTimeAsync(9000);
    expect(lightBrightnessCalls()).toEqual([]);

    callService.mockClear();
    buildDashboardState.mockResolvedValue(stateWith({ brightness: 255, lastSunState: "above_horizon" }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(lightBrightnessCalls()).toEqual([]);
  });
});
