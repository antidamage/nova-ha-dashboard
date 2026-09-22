import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYLISTS } from "../../../lib/apple-tv/playlists";

const preferences = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../../../lib/preferences", () => ({
  readDashboardPreferences: vi.fn(async () => preferences.current),
  mergeDashboardPreferences: vi.fn(async (next: Record<string, unknown>) => {
    // Mirrors the real merge's appleTV branch: a caller writing only the
    // playlists must not lose the round-trip stamp beside them.
    const nextAmp = (next.appleTV ?? {}) as Record<string, unknown>;
    const currentAmp = (preferences.current.appleTV ?? {}) as Record<string, unknown>;
    preferences.current = {
      ...preferences.current,
      appleTV: { ...currentAmp, ...nextAmp, updatedAt: "2026-09-22T00:00:00.000Z" },
    };
  }),
}));

vi.mock("../../../lib/control-attribution", () => ({ attributeControl: vi.fn(async () => undefined) }));

const { GET, PUT } = await import("./route");
const { mergeDashboardPreferences } = await import("../../../lib/preferences");
const { attributeControl } = await import("../../../lib/control-attribution");

/** The preset a list writes once nothing is set on it. */
const plain = (name: string) => ({ name, icon: null, shuffle: false, repeat: "off" });

function put(body: unknown) {
  return new Request("http://localhost/api/appletv", { body: JSON.stringify(body), method: "PUT" });
}

describe("/api/appletv", () => {
  beforeEach(() => {
    preferences.current = {};
    vi.clearAllMocks();
  });

  it("hands out the three shipped presets when nothing is stored", async () => {
    const payload = await (await GET()).json();
    expect(payload.playlists.map((preset: { name: string }) => preset.name)).toEqual(DEFAULT_PLAYLISTS);
    expect(payload.playlists[0]).toEqual(plain(DEFAULT_PLAYLISTS[0]));
  });

  it("reads a list written before icons and playback types existed", async () => {
    // The file outlives the build that wrote it: a bare name is a preset with
    // nothing set rather than an entry to drop.
    preferences.current = { appleTV: { playlists: ["Excellent", "Cool"] } };
    const payload = await (await GET()).json();
    expect(payload.playlists).toEqual([plain("Excellent"), plain("Cool")]);
  });

  it("stores a preset's icon, shuffle and playback type, and hands back what landed", async () => {
    const stored = { name: "Excellent", icon: "flame", shuffle: true, repeat: "infinite" };
    const response = await PUT(put({ playlists: [stored] }));

    expect(response.status).toBe(200);
    expect((await response.json()).playlists).toEqual([stored]);
    expect(mergeDashboardPreferences).toHaveBeenCalledWith({ appleTV: { playlists: [stored] } });
    expect(attributeControl).toHaveBeenCalledTimes(1);
  });

  it("normalises what the dial could not draw: an unknown icon, an unknown mode, a truthy shuffle", async () => {
    const response = await PUT(put({
      playlists: [
        { name: " Excellent ", icon: "saxophone", shuffle: "yes", repeat: "sometimes" },
        { name: "Cool", icon: "star", shuffle: true, repeat: "all" },
      ],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).playlists).toEqual([
      plain("Excellent"),
      { name: "Cool", icon: "star", shuffle: true, repeat: "all" },
    ]);
  });

  it("refuses an entry with no name rather than emptying the preset row with a 200", async () => {
    // The list is written whole, so a body the dial could not draw in full is a
    // client bug: dropping the entry would answer 200 and take the button away.
    for (const entry of [{}, { name: "  " }, { icon: "flame" }, "   "]) {
      const response = await PUT(put({ playlists: [entry, { name: "Cool" }] }));
      expect(response.status, JSON.stringify(entry)).toBe(400);
    }
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });

  it("drops the duplicates the list itself cannot hold, keeping the first", async () => {
    const response = await PUT(put({ playlists: [{ name: "Cool" }, { name: "cool" }, { name: "Second" }] }));

    expect(response.status).toBe(200);
    const stored = (await response.json()).playlists as { name: string }[];
    expect(stored.map((preset) => preset.name)).toEqual(["Cool", "Second"]);
  });

  it("refuses a body that is not a list of names or presets, writing nothing", async () => {
    for (const body of [{}, { playlists: "Cool" }, { playlists: [7] }, { playlists: [null] }]) {
      const response = await PUT(put(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const notJson = await PUT(new Request("http://localhost/api/appletv", { body: "{", method: "PUT" }));
    expect(notJson.status).toBe(400);
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });

  it("refuses more presets than the dial holds", async () => {
    const response = await PUT(put({ playlists: Array.from({ length: 7 }, (_, index) => ({ name: `Playlist ${index}` })) }));

    expect(response.status).toBe(400);
    expect(mergeDashboardPreferences).not.toHaveBeenCalled();
  });
});
