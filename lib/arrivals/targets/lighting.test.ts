import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoneLightRule } from "../../zone-light-rules";

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const triggerZoneLightRule = vi.hoisted(() => vi.fn(async (_rule: ZoneLightRule) => undefined));

vi.mock("../../dashboard-config", () => ({ readDashboardConfig: vi.fn(async () => config.current) }));
vi.mock("../../ha", () => ({
  buildDashboardState: vi.fn(async () => ({
    zones: [
      { id: "office", name: "Office", entities: [] },
      { id: "den", name: "Den", entities: [] },
    ],
  })),
  triggerZoneLightRule,
}));

const { lightingArrivalTarget } = await import("./lighting");

beforeEach(() => {
  triggerZoneLightRule.mockClear();
  config.current = {
    dashboard: {
      lighting: {
        zoneRules: [
          {
            id: "candlelight-office",
            zoneId: "office",
            name: "Candlelight",
            enabled: true,
            kind: "preset",
            value: { hue: 30, saturation: 60, brightnessPct: 40 },
            preset: { show: true, order: 3 },
          },
        ],
        // office has been edited in the zone editor, so it carries its stored
        // rules and no longer gets the default Adaptive/White injected; den has
        // never been seeded, so both are still its defaults.
        zoneRulesSeededZoneIds: ["office", "spare"],
      },
    },
  };
});

describe("lighting arrival target", () => {
  it("offers each room's preset row, grouped by room", async () => {
    const presets = await lightingArrivalTarget.presets();
    const ids = presets.map((preset) => preset.id);

    expect(ids).toContain("candlelight-office");
    expect(ids).toContain("builtin-on:office");
    expect(ids).toContain("builtin-off:office");
    expect(ids).toContain("adaptive-den");
    expect(ids).toContain("white-den");
    // A seeded zone no longer carries the default preset rules it replaced.
    expect(ids).not.toContain("adaptive-office");
    // A zone id in the seeded list that is not a room in state is not offered.
    expect(ids.some((id) => id.endsWith("spare"))).toBe(false);
    expect(presets.find((preset) => preset.id === "candlelight-office")).toEqual({
      id: "candlelight-office",
      label: "Office · Candlelight",
      group: "Office",
    });
  });

  it("applies a preset through the zone rule trigger", async () => {
    await lightingArrivalTarget.apply("builtin-off:office");

    expect(triggerZoneLightRule).toHaveBeenCalledTimes(1);
    expect(triggerZoneLightRule.mock.calls[0][0]).toMatchObject({ id: "builtin-off:office", zoneId: "office" });
  });

  it("refuses a preset that does not exist", async () => {
    await expect(lightingArrivalTarget.apply("no-such-rule")).rejects.toThrow("Unknown lighting preset: no-such-rule");
    expect(triggerZoneLightRule).not.toHaveBeenCalled();
  });
});
