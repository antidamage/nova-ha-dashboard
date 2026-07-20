import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let prefsPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nova-prefs-"));
  prefsPath = path.join(dir, "dashboard-preferences.json");
  process.env.NOVA_DASHBOARD_PREFERENCES = prefsPath;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.NOVA_DASHBOARD_PREFERENCES;
});

async function load() {
  return await import("./preferences");
}

describe("dashboard preferences", () => {
  it("returns an empty object when the file does not exist", async () => {
    const { readDashboardPreferences } = await load();
    expect(await readDashboardPreferences()).toEqual({});
  });

  it("merges aircon settings and stamps updatedAt", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ aircon: { temperature: 21 } });
    const stored = await readDashboardPreferences();
    expect(stored.aircon?.temperature).toBe(21);
    expect(stored.aircon?.updatedAt).toBeTruthy();
  });

  it("deep-merges nested lighting candlelight zones across writes", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ lighting: { adaptiveCandlelightZones: { lounge: { enabled: true } } } });
    await mergeDashboardPreferences({ lighting: { adaptiveCandlelightZones: { bedroom: { enabled: false } } } });
    const stored = await readDashboardPreferences();
    expect(stored.lighting?.adaptiveCandlelightZones).toEqual({
      lounge: { enabled: true },
      bedroom: { enabled: false },
    });
  });

  it("drops undefined values rather than overwriting existing ones", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ aircon: { temperature: 20, hvacMode: "cool" } });
    await mergeDashboardPreferences({ aircon: { temperature: undefined, hvacMode: "heat" } });
    const stored = await readDashboardPreferences();
    expect(stored.aircon?.temperature).toBe(20);
    expect(stored.aircon?.hvacMode).toBe("heat");
  });

  it("persists merged JSON atomically to the configured path", async () => {
    const { mergeDashboardPreferences } = await load();
    await mergeDashboardPreferences({ panelHeater: { offTimerEndsAt: "2026-06-16T10:00:00Z" } });
    const onDisk = JSON.parse(await readFile(prefsPath, "utf8"));
    expect(onDisk.panelHeater.offTimerEndsAt).toBe("2026-06-16T10:00:00Z");
  });

  it("merges voice controls without dropping the other voice fields", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await Promise.all([
      mergeDashboardPreferences({ voice: { speaker: "Aiden" } }),
      mergeDashboardPreferences({ voice: { speechRate: 115 } }),
    ]);
    const stored = await readDashboardPreferences();

    expect(stored.voice?.speaker).toBe("Aiden");
    expect(stored.voice?.speechRate).toBe(115);
    expect(stored.voice?.updatedAt).toBeTruthy();
  });

  it("merges Agent loop controls without dropping independent bounds", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await Promise.all([
      mergeDashboardPreferences({ agent: { ralphLoopMaxIterations: 12 } }),
      mergeDashboardPreferences({ agent: { ralphLoopFailureSeconds: 6 } }),
    ]);
    const stored = await readDashboardPreferences();

    expect(stored.agent?.ralphLoopMaxIterations).toBe(12);
    expect(stored.agent?.ralphLoopFailureSeconds).toBe(6);
    expect(stored.agent?.updatedAt).toBeTruthy();
  });
});
