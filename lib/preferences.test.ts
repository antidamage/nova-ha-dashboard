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
  process.env.NOVA_DASHBOARD_DEFAULT_PREFERENCES = path.join(dir, "missing-default-preferences.json");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.NOVA_DASHBOARD_PREFERENCES;
  delete process.env.NOVA_DASHBOARD_DEFAULT_PREFERENCES;
});

async function load() {
  return await import("./preferences");
}

describe("dashboard preferences", () => {
  it("returns an empty object when the file does not exist", async () => {
    const { readDashboardPreferences } = await load();
    expect(await readDashboardPreferences()).toEqual({});
  });

  it("falls back to the shipped base-install preferences", async () => {
    delete process.env.NOVA_DASHBOARD_DEFAULT_PREFERENCES;
    vi.resetModules();
    const { readDashboardPreferences } = await load();
    const preferences = await readDashboardPreferences();

    expect(preferences.voice?.agentName).toBe("[◯_◯]");
    expect(preferences.themeLibrary?.activeId).toBe("theme_mq77kutb_7vrn4x1i");
    const library = preferences.themeLibrary as {
      activeId: string;
      entries: Array<{ id: string; name: string; themeSet: Record<string, unknown> }>;
    };
    const active = library.entries.find((entry) => entry.id === library.activeId);
    expect(active?.name).toBe("Human Revolution");
    expect(preferences.theme).toEqual(active?.themeSet);
  });

  it("keeps writing after a failed write, rather than poisoning the queue", async () => {
    const { writeFile } = await import("fs/promises");
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ aircon: { temperature: 20 } });

    // The real-world trigger: the preferences file becomes unparseable, so the
    // read inside the queued write throws.
    await writeFile(prefsPath, "{ this is not json", "utf8");
    await expect(mergeDashboardPreferences({ aircon: { temperature: 21 } })).rejects.toThrow();

    // That failure belongs to its caller alone. Before the fix the shared queue
    // stayed a rejected promise, so this write — and every write after it, for
    // the life of the process — failed with the SAME stale parse error even
    // though the file is fine again.
    await writeFile(prefsPath, JSON.stringify({ aircon: { temperature: 20 } }), "utf8");
    await mergeDashboardPreferences({ aircon: { temperature: 22 } });
    expect((await readDashboardPreferences()).aircon?.temperature).toBe(22);
  });

  it("reads a preferences file that picked up a UTF-8 BOM", async () => {
    const { writeFile } = await import("fs/promises");
    await writeFile(prefsPath, `﻿${JSON.stringify({ aircon: { temperature: 19 } })}`, "utf8");
    const { readDashboardPreferences } = await load();
    expect((await readDashboardPreferences()).aircon?.temperature).toBe(19);
  });

  it("keeps other modules' orb display config when one module is saved", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({
      orbInfo: { moduleId: "gym", modules: { clock: { display: { clock12Hour: true } } } },
    });
    // Saving the gym's decimals must not wipe the clock's 12-hour setting: the
    // `modules` map needs its own merge, not just the orbInfo object's.
    await mergeDashboardPreferences({ orbInfo: { modules: { gym: { display: { decimals: 2 } } } } });

    const stored = await readDashboardPreferences();
    expect(stored.orbInfo?.modules?.clock?.display?.clock12Hour).toBe(true);
    expect(stored.orbInfo?.modules?.gym?.display?.decimals).toBe(2);
    // And changing only the modules map must not drop the selection.
    expect(stored.orbInfo?.moduleId).toBe("gym");
  });

  it("keeps saved orb module config when only the selection changes", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ orbInfo: { modules: { gym: { display: { decimals: 3 } } } } });
    await mergeDashboardPreferences({ orbInfo: { moduleId: "none" } });

    const stored = await readDashboardPreferences();
    expect(stored.orbInfo?.moduleId).toBe("none");
    expect(stored.orbInfo?.modules?.gym?.display?.decimals).toBe(3);
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

  it("merges a bedroom heater field without dropping mode or temperature", async () => {
    // Regression: the top-level spread used to replace the whole bedroomHeater
    // object, so saving one field erased mode and temperature and stranded the
    // server thermostat mid-heat.
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ bedroomHeater: { mode: "auto", temperature: 21 } });
    await mergeDashboardPreferences({ bedroomHeater: { offTimerEndsAt: "2026-08-19T10:00:00Z" } });
    const stored = await readDashboardPreferences();
    expect(stored.bedroomHeater?.mode).toBe("auto");
    expect(stored.bedroomHeater?.temperature).toBe(21);
    expect(stored.bedroomHeater?.offTimerEndsAt).toBe("2026-08-19T10:00:00Z");
  });

  it("merges one climate instance without dropping the others, or the rest of its own settings", async () => {
    // The same hazard as the bedroom heater above, one level deeper: a patch
    // names one instance and usually one field, so both levels must merge.
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ climate: { study: { aircon: { mode: "auto", temperature: 21 } } } });
    await mergeDashboardPreferences({ climate: { garage: { heater: { mode: "auto", temperature: 12 } } } });
    // A later patch touching one field of one instance.
    await mergeDashboardPreferences({ climate: { study: { aircon: { temperature: 19 } } } });

    const stored = await readDashboardPreferences();
    expect(stored.climate?.study?.aircon?.temperature).toBe(19);
    // Not erased by the narrow patch...
    expect(stored.climate?.study?.aircon?.mode).toBe("auto");
    // ...and the other instance survives entirely.
    expect(stored.climate?.garage?.heater?.mode).toBe("auto");
    expect(stored.climate?.garage?.heater?.temperature).toBe(12);
  });

  it("keeps the first-of-kind keys and the instance record independent", async () => {
    const { mergeDashboardPreferences, readDashboardPreferences } = await load();
    await mergeDashboardPreferences({ bedroomHeater: { mode: "auto", temperature: 18 } });
    await mergeDashboardPreferences({ climate: { garage: { heater: { mode: "off" } } } });

    const stored = await readDashboardPreferences();
    expect(stored.bedroomHeater?.mode).toBe("auto");
    expect(stored.bedroomHeater?.temperature).toBe(18);
    expect(stored.climate?.garage?.heater?.mode).toBe("off");
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
