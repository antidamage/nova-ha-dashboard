import { afterEach, describe, expect, it, vi } from "vitest";
import { readDefaultDashboardConfig } from "./dashboard-config";
import {
  DEMO_CONFIG_STORAGE_KEY,
  DEMO_THEME_STORAGE_KEY,
  demoClientConfig,
  demoConfigBootstrapScript,
  demoSecretSetupStatus,
} from "./demo-config";

const DEMO_THEME = {
  theme: {
    accent: { cursor: { x: 0.26, y: 1 }, intensity: 22, rgb: [255, 255, 255] },
    highlight: { cursor: { x: 0.77, y: 0 }, intensity: 55, rgb: [162, 0, 255] },
  },
  updatedAt: "2026-06-04T00:00:00.000Z",
};

describe("demo config storage", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("projects the client config from the full dashboard config", async () => {
    const config = await readDefaultDashboardConfig();
    const clientConfig = demoClientConfig(config);

    expect(clientConfig.dashboard.aircon).toEqual(config.dashboard.aircon);
    expect(clientConfig.dashboard.lighting).toEqual(config.dashboard.lighting);
    expect(clientConfig.mapWeather).toEqual(config.mapWeather);
  });

  it("reports demo secrets without exposing real setup state", async () => {
    const config = await readDefaultDashboardConfig();
    const secrets = demoSecretSetupStatus(config);

    expect(secrets.homeAssistant.urlConfigured).toBe(false);
    expect(secrets.homeAssistant.tokenConfigured).toBe(false);
    expect(secrets.mcp.authRequired).toBe(config.mcp.requireBearerAuth);
  });

  it("serves demo config routes from session storage after seeding defaults", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    const nativeFetch = vi.fn(async () => new Response("native fetch", { status: 418 }));
    vi.stubGlobal("fetch", nativeFetch);

    new Function(demoConfigBootstrapScript(defaultConfig, "https://provider.example/demo/"))();

    expect(window.sessionStorage.getItem(DEMO_CONFIG_STORAGE_KEY)).toBeTruthy();

    const initialResponse = await fetch("/api/config");
    const initialPayload = await initialResponse.json();
    expect(initialPayload.config.dashboard.aircon.offTimerIncrementMinutes)
      .toBe(defaultConfig.dashboard.aircon.offTimerIncrementMinutes);
    expect(initialResponse.headers.get("X-Nova-Demo-Config")).toBe("session-storage");

    const updateResponse = await fetch("/api/config", {
      body: JSON.stringify({
        config: {
          dashboard: {
            aircon: {
              offTimerIncrementMinutes: 15,
            },
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    const updatePayload = await updateResponse.json();
    expect(updatePayload).toMatchObject({ applied: true, ok: true });

    const clientResponse = await fetch("/api/config/client");
    const clientPayload = await clientResponse.json();
    expect(clientPayload.dashboard.aircon.offTimerIncrementMinutes).toBe(15);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("serves and persists the demo theme from session storage", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    const nativeFetch = vi.fn(async () => new Response("native fetch", { status: 418 }));
    vi.stubGlobal("fetch", nativeFetch);

    new Function(demoConfigBootstrapScript(defaultConfig, "https://provider.example/demo/", DEMO_THEME))();

    expect(window.sessionStorage.getItem(DEMO_THEME_STORAGE_KEY)).toBeTruthy();

    const initialResponse = await fetch("/api/theme");
    const initialPayload = await initialResponse.json();
    expect(initialPayload.theme.highlight.rgb).toEqual([162, 0, 255]);
    expect(initialResponse.headers.get("X-Nova-Demo-Config")).toBe("session-storage");

    const updateResponse = await fetch("/api/theme", {
      body: JSON.stringify({ theme: { selection: "dark", themes: { dark: { accent: { rgb: [1, 2, 3] } } } } }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const updatePayload = await updateResponse.json();
    expect(updatePayload.theme.themes.dark.accent.rgb).toEqual([1, 2, 3]);
    expect(updatePayload.updatedAt).toBeTruthy();

    const reread = await (await fetch("/api/theme")).json();
    expect(reread.theme.themes.dark.accent.rgb).toEqual([1, 2, 3]);

    const settingResponse = await fetch("/api/theme", {
      body: JSON.stringify({ followVisualizerWhenActive: true }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const settingPayload = await settingResponse.json();
    expect(settingPayload.followVisualizerWhenActive).toBe(true);
    expect(settingPayload.theme.themes.dark.accent.rgb).toEqual([1, 2, 3]);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("resets incompatible stored config back to defaults", async () => {
    const defaultConfig = await readDefaultDashboardConfig();
    window.sessionStorage.setItem(DEMO_CONFIG_STORAGE_KEY, JSON.stringify({ schemaVersion: 999 }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("native fetch", { status: 418 })));

    new Function(demoConfigBootstrapScript(defaultConfig, "https://provider.example/demo/"))();

    const stored = JSON.parse(window.sessionStorage.getItem(DEMO_CONFIG_STORAGE_KEY) ?? "{}");
    expect(stored.schemaVersion).toBe(defaultConfig.schemaVersion);
    expect(stored.dashboard.defaultZoneId).toBe(defaultConfig.dashboard.defaultZoneId);
  });
});
