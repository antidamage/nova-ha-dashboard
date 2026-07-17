import { beforeEach, describe, expect, it, vi } from "vitest";

const haRest = vi.fn();
const readRegistrySnapshot = vi.fn();

vi.mock("./ha/client", () => ({ haRest: (...args: unknown[]) => haRest(...args) }));
vi.mock("./ha/registry", () => ({ readRegistrySnapshot: () => readRegistrySnapshot() }));

function state(entity_id: string, friendly_name?: string) {
  return { entity_id, state: "on", attributes: friendly_name ? { friendly_name } : {} };
}

const emptyRegistry = { areas: [], entities: [], labels: [] };

describe("scaffoldDashboardConfig", () => {
  beforeEach(() => {
    haRest.mockReset();
    readRegistrySnapshot.mockReset();
  });

  it("detects weather, sun, and assist-satellite entities into the proposal", async () => {
    haRest.mockResolvedValue([
      state("weather.home"),
      state("sun.sun"),
      state("assist_satellite.kitchen"),
      state("light.lounge"),
    ]);
    readRegistrySnapshot.mockResolvedValue(emptyRegistry);

    const { scaffoldDashboardConfig } = await import("./config-scaffold");
    const result = await scaffoldDashboardConfig();
    const ha = result.proposal.homeAssistant as Record<string, unknown>;
    expect(ha.weatherEntityId).toBe("weather.home");
    expect(ha.sunEntityId).toBe("sun.sun");
    expect(ha.novaAssistSatelliteEntityId).toBe("assist_satellite.kitchen");
    expect(result.detected.weatherEntities).toEqual(["weather.home"]);
  });

  it("matches router sensors by keyword", async () => {
    haRest.mockResolvedValue([
      state("sensor.router_wan_status", "WAN status"),
      state("sensor.router_download_speed", "Download speed"),
      state("sensor.router_upload_speed", "Upload speed"),
    ]);
    readRegistrySnapshot.mockResolvedValue(emptyRegistry);

    const { scaffoldDashboardConfig } = await import("./config-scaffold");
    const result = await scaffoldDashboardConfig();
    const router = (result.proposal.homeAssistant as Record<string, { wanStatusEntityId?: string }>).router as Record<string, string>;
    expect(router.wanStatusEntityId).toBe("sensor.router_wan_status");
    expect(router.downloadSpeedEntityId).toBe("sensor.router_download_speed");
    expect(router.uploadSpeedEntityId).toBe("sensor.router_upload_speed");
  });

  it("suggests labelling switches that look like illumination", async () => {
    haRest.mockResolvedValue([state("switch.hallway_lamp", "Hallway Lamp")]);
    readRegistrySnapshot.mockResolvedValue(emptyRegistry);

    const { scaffoldDashboardConfig } = await import("./config-scaffold");
    const result = await scaffoldDashboardConfig();
    expect(result.detected.illuminationCandidates).toContain("switch.hallway_lamp");
    expect(result.suggestions.some((s) => s.includes("nova_illumination"))).toBe(true);
  });

  it("warns when no weather entity exists", async () => {
    haRest.mockResolvedValue([state("light.lounge")]);
    readRegistrySnapshot.mockResolvedValue(emptyRegistry);

    const { scaffoldDashboardConfig } = await import("./config-scaffold");
    const result = await scaffoldDashboardConfig();
    expect(result.suggestions.some((s) => s.includes("No weather"))).toBe(true);
  });

  it("flags room areas missing a temperature binding", async () => {
    haRest.mockResolvedValue([state("weather.home")]);
    readRegistrySnapshot.mockResolvedValue({
      ...emptyRegistry,
      areas: [{ id: "lounge", name: "Lounge", temperature_entity_id: null, humidity_entity_id: null }],
    });

    const { scaffoldDashboardConfig } = await import("./config-scaffold");
    const result = await scaffoldDashboardConfig();
    expect(result.suggestions.some((s) => s.includes("Lounge"))).toBe(true);
  });
});
