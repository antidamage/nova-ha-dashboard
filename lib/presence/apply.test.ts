import { beforeEach, describe, expect, it, vi } from "vitest";

// specs/home-users.md section 5: the presence applier only switches lights
// through the light layer, and only ever writes a heater `mode: "off"`.

const intent = vi.hoisted(() => vi.fn(async (_intent: Record<string, unknown>) => undefined));
const zoneAction = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => undefined));
const allAction = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => undefined));

vi.mock("../climate-control", () => ({ applyClimateControlIntent: intent }));
vi.mock("../climate-instances", () => ({
  heaterInstances: () => [
    { kind: "heater", id: "loft" },
    { kind: "heater", id: "panel", zoneId: "den" },
  ],
}));
vi.mock("../ha", () => ({
  buildDashboardState: async () => ({
    zones: [
      { id: "loft", name: "Loft", entities: [{ entity_id: "light.l", domain: "light" }] },
      { id: "outside", name: "Outside", entities: [{ entity_id: "light.o", domain: "light" }] },
      { id: "empty", name: "Empty", entities: [] },
    ],
  }),
}));
vi.mock("../ha/lighting/zone-lighting-actions", () => ({
  setZoneLightingAction: zoneAction,
  setAllLightingAction: allAction,
}));

const { applyPresenceActions, heatersForZone } = await import("./apply");

beforeEach(() => {
  intent.mockClear();
  zoneAction.mockClear();
  allAction.mockClear();
});

describe("applyPresenceActions", () => {
  it("writes heaters off and never anything else", async () => {
    await applyPresenceActions([{ kind: "heater-off", zones: ["loft", "den"] }], {} as never);
    expect(intent.mock.calls.map(([call]) => call)).toEqual([
      { room: "loft", mode: "off" },
      { room: "panel", mode: "off" },
    ]);
  });

  it("switches lights through the light layer; outside on plain power, rooms adaptive", async () => {
    const results = await applyPresenceActions(
      [{ kind: "lights-on", zones: ["loft", "outside", "empty"] }, { kind: "lights-off-house" }],
      {} as never,
    );
    expect(zoneAction.mock.calls.map(([call]) => call)).toEqual([
      { zoneId: "loft", action: "on", mode: "adaptive" },
      { zoneId: "outside", action: "on", mode: "power" },
    ]);
    expect(allAction).toHaveBeenCalledWith({ action: "off" });
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("reports a failure and still attempts the rest", async () => {
    zoneAction.mockRejectedValueOnce(new Error("boom"));
    const results = await applyPresenceActions(
      [{ kind: "lights-off", zones: ["loft"] }, { kind: "heater-off", zones: ["loft"] }],
      {} as never,
    );
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(intent).toHaveBeenCalledTimes(1);
  });
});

describe("heatersForZone", () => {
  it("binds by zoneId, or by the room's id when the instance has none", () => {
    expect(heatersForZone({} as never, "den").map((heater) => heater.id)).toEqual(["panel"]);
    expect(heatersForZone({} as never, "loft").map((heater) => heater.id)).toEqual(["loft"]);
  });
});
