import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A one-frame WAV, small enough to stand in for an uploaded click.
const CLIP_BASE64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const CLIP_DATA_URL = `data:audio/mpeg;base64,${CLIP_BASE64}`;

let directory = "";
let preferencesFile = "";

async function writePreferences(value: unknown) {
  await writeFile(preferencesFile, JSON.stringify(value), "utf8");
}

async function readPreferences() {
  return JSON.parse(await readFile(preferencesFile, "utf8")) as Record<string, never>;
}

async function migrate() {
  // Imported per test so it picks up this test's environment paths.
  const { migrateControlSoundIntoLibrary } = await import("./sound-migration");
  await migrateControlSoundIntoLibrary();
}

function themeWith(overrides: Record<string, unknown> = {}) {
  return {
    controlSound: { name: "soft_click.mp3", source: CLIP_DATA_URL, volume: 45 },
    timerSound: "Tink",
    uxSounds: {
      buttonPress: "button-press",
      dialClick: "button-press",
      timerAlert: "timer-chime",
      foldBreak: "medium-ratchet",
      lightsOff: null,
    },
    ...overrides,
  };
}

describe("control sound migration", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "nova-sound-migration-"));
    preferencesFile = path.join(directory, "dashboard-preferences.json");
    process.env.NOVA_DASHBOARD_PREFERENCES = preferencesFile;
    process.env.NOVA_DASHBOARD_SOUNDS = path.join(directory, "sounds");
    process.env.NOVA_DASHBOARD_HISTORY = path.join(directory, "history");
    // lib/preferences.ts reads its path once at module load, so each test needs
    // a fresh module graph pointed at its own temp directory.
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.NOVA_DASHBOARD_PREFERENCES;
    delete process.env.NOVA_DASHBOARD_SOUNDS;
    delete process.env.NOVA_DASHBOARD_HISTORY;
  });

  it("imports the uploaded clip and repoints the sentinels at it", async () => {
    await writePreferences({ theme: { selection: "dark", themes: { dark: themeWith() } } });
    await migrate();

    const preferences = await readPreferences() as unknown as {
      soundLibrary: { entries: { id: string; name: string; bytes: number }[] };
      theme: { themes: { dark: Record<string, unknown> } };
    };

    const [entry] = preferences.soundLibrary.entries;
    expect(entry.name).toBe("soft_click");
    expect(entry.bytes).toBeGreaterThan(0);
    // The bytes actually landed on disk, where /api/sounds/<id> serves them.
    const stored = await readFile(path.join(directory, "sounds", `${entry.id}.mp3`));
    expect(stored.byteLength).toBe(entry.bytes);

    const theme = preferences.theme.themes.dark as {
      controlSound: Record<string, unknown>;
      timerSound?: string;
      uxSounds: Record<string, string | null>;
    };
    expect(theme.uxSounds.buttonPress).toBe(entry.id);
    expect(theme.uxSounds.dialClick).toBe(entry.id);
    // The timer sentinel becomes the built-in chime that theme was set to.
    expect(theme.uxSounds.timerAlert).toBe("chime-tink");
    // Everything else is left exactly as it was.
    expect(theme.uxSounds.foldBreak).toBe("medium-ratchet");
    expect(theme.uxSounds.lightsOff).toBeNull();
    // The retired fields are gone, but the volume survives.
    expect(theme.controlSound).toEqual({ volume: 45 });
    expect(theme.timerSound).toBeUndefined();
  });

  it("imports a clip shared by two themes once", async () => {
    await writePreferences({
      theme: { selection: "dark", themes: { dark: themeWith(), light: themeWith() } },
      themeLibrary: { presets: [{ name: "Saved", themes: { dark: themeWith() } }] },
    });
    await migrate();

    const preferences = await readPreferences() as unknown as {
      soundLibrary: { entries: { id: string }[] };
    };
    expect(preferences.soundLibrary.entries).toHaveLength(1);
  });

  it("falls back to the default click for a theme that never uploaded one", async () => {
    await writePreferences({
      theme: {
        selection: "dark",
        themes: { dark: themeWith({ controlSound: { name: null, source: null, volume: 60 } }) },
      },
    });
    await migrate();

    const preferences = await readPreferences() as unknown as {
      soundLibrary: { entries: unknown[] };
      theme: { themes: { dark: { uxSounds: Record<string, string> } } };
    };
    expect(preferences.soundLibrary.entries).toHaveLength(0);
    expect(preferences.theme.themes.dark.uxSounds.buttonPress).toBe("medium-mechanical-click");
  });

  it("writes nothing once every theme is migrated", async () => {
    await writePreferences({
      theme: {
        selection: "dark",
        themes: { dark: { controlSound: { volume: 60 }, uxSounds: { buttonPress: "light-ratchet" } } },
      },
    });
    const before = await readFile(preferencesFile, "utf8");
    await migrate();
    expect(await readFile(preferencesFile, "utf8")).toBe(before);
  });
});
