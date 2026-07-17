import { describe, expect, it, vi } from "vitest";
import {
  dashboardConfigJsonSchema,
  parseMapCenter,
  readDefaultDashboardConfig,
  readSecretSetupStatus,
  validateDashboardConfig,
} from "./dashboard-config";

describe("dashboard config schema", () => {
  it("accepts the shipped merged default config", async () => {
    const config = await readDefaultDashboardConfig();
    const result = validateDashboardConfig(config);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.schemaVersion).toBe(1);
      expect(result.config.homeAssistant.router.name).toBeTruthy();
      expect(result.config.homeAssistant.router.downloadSpeedEntityId).toMatch(/^sensor\./);
      expect(result.config.dashboard.lighting.intensityThresholds).toBeInstanceOf(Array);
      expect(result.config.dashboard.lighting.entityPresets).toBeInstanceOf(Array);
    }
  });

  it("returns path-aware validation errors", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    const result = validateDashboardConfig({
      ...defaultConfig,
      homeAssistant: {
        ...defaultConfig.homeAssistant,
        weatherEntityId: "",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "homeAssistant.weatherEntityId")).toBe(true);
    }
  });

  it("exports a JSON schema document", () => {
    const schema = dashboardConfigJsonSchema() as Record<string, unknown> & { $id: string; title: string };

    expect(schema.$id).toContain("dashboard-config");
    expect(schema.title).toBe("Nova Dashboard Config");
    expect(schema.type).toBe("object");
  });

  it("parses map center env compatibility values", () => {
    expect(parseMapCenter("-36.1,174.2")).toEqual({ lat: -36.1, lng: 174.2 });
    expect(parseMapCenter("not-a-coordinate")).toBeUndefined();
  });
});

describe("secret setup status", () => {
  it("reports configured secrets without exposing values", async () => {
    vi.stubEnv("HA_TOKEN", "secret-token");
    vi.stubEnv("ICLOUD_USERNAME", "person@example.com");
    vi.stubEnv("ICLOUD_APP_PASSWORD", "app-password");
    vi.stubEnv("POWERSHOP_EMAIL", "");
    vi.stubEnv("POWERSHOP_PASSWORD", "");
    vi.stubEnv("NOVA_DASHBOARD_MCP_TOKEN", "mcp-token");

    const status = await readSecretSetupStatus();

    expect(status.homeAssistant.tokenConfigured).toBe(true);
    expect(status.iCloud.enabled).toBe(true);
    expect(status.powershop.enabled).toBe(false);
    expect(JSON.stringify(status)).not.toContain("secret-token");
    vi.unstubAllEnvs();
  });
});
