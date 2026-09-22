import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  calls: [] as Array<{ data: Record<string, unknown>; domain: string; service: string }>,
  /** What `/api/states/<entity>` answers, first entry repeated. */
  states: [] as string[],
  sourceEntityId: "media_player.home_theatre" as string | undefined,
  playlists: undefined as unknown,
  failAt: null as string | null,
  /** Every step in the order it happened, so the handover order is pinned. */
  order: [] as string[],
  commands: [] as Array<{ name: string; repeat: string; shuffle: boolean }>,
}));

vi.mock("../../../../lib/ha/client", () => ({
  callService: vi.fn(async (domain: string, service: string, data: Record<string, unknown>) => {
    host.order.push(service);
    if (host.failAt === service) throw new Error("Home Assistant refused it");
    host.calls.push({ data, domain, service });
    return [];
  }),
  // The states are consumed in order, the last one repeating: a device that is
  // "off" and then "idle" reads as one that woke on the first poll.
  haRest: vi.fn(async () => ({ state: host.states.length > 1 ? (host.states.shift() as string) : host.states[0] ?? "idle" })),
}));

vi.mock("../../../../lib/dashboard-config", () => ({
  readDashboardConfig: async () => ({ power: { ampPowerControl: { sourceEntityId: host.sourceEntityId } } }),
}));

vi.mock("../../../../lib/preferences", () => ({
  readDashboardPreferences: async () => ({ appleTV: { playlists: host.playlists } }),
}));

vi.mock("../../../../lib/control-attribution", () => ({ attributeControl: vi.fn(async () => undefined) }));

vi.mock("../../../../lib/appletv-command", () => ({
  writePlayCommand: vi.fn(async (preset: { name: string; repeat: string; shuffle: boolean }) => {
    host.order.push("command");
    host.commands.push(preset);
    return { at: "2026-09-22T00:00:00.000Z", id: host.commands.length, ...preset };
  }),
}));

const { POST } = await import("./route");
const { attributeControl } = await import("../../../../lib/control-attribution");

function play(index: unknown) {
  return new Request("http://localhost/api/appletv/play", { body: JSON.stringify({ index }), method: "POST" });
}

/** The service calls the route made, in order, as `service` names. */
const services = () => host.order.filter((step) => step !== "command");
const call = (service: string) => host.calls.find((entry) => entry.service === service);

describe("/api/appletv/play", () => {
  beforeEach(() => {
    host.calls = [];
    host.states = ["idle"];
    host.sourceEntityId = "media_player.home_theatre";
    host.playlists = undefined;
    host.failAt = null;
    host.order = [];
    host.commands = [];
    vi.clearAllMocks();
  });

  it("brings our own app forward, leaves it the preset, and applies the playback modes", async () => {
    const response = await POST(play(0));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      command: 1,
      entity: "media_player.home_theatre",
      name: "Excellent",
      repeat: "off",
      shuffle: false,
    });
    // The app is launched by bundle id — it is where the MusicKit session is.
    expect(call("play_media")?.data).toEqual({
      entity_id: "media_player.home_theatre",
      media_content_type: "app",
      media_content_id: "nz.co.skull.NovaAppleTVDashboard",
    });
    expect(host.commands).toEqual([{ name: "Excellent", repeat: "off", shuffle: false }]);
    expect(services()).toEqual(["play_media", "shuffle_set", "repeat_set"]);
    expect(attributeControl).toHaveBeenCalledTimes(1);
  });

  it("leaves the command after the launch, never before it", async () => {
    await POST(play(0));

    // An app that is not on screen yet is not polling, and a command written
    // before the launch would sit there unread.
    expect(host.order).toEqual(["play_media", "command", "shuffle_set", "repeat_set"]);
  });

  it("does not start whatever was loaded: the press launches and hands over, and never presses play", async () => {
    await POST(play(0));

    expect(services()).not.toContain("media_play");
  });

  it("wakes a sleeping Apple TV and waits for it rather than launching into it", async () => {
    host.states = ["off", "idle"];

    const response = await POST(play(0));

    expect(response.status).toBe(200);
    expect(services()).toEqual(["turn_on", "play_media", "shuffle_set", "repeat_set"]);
    expect(call("turn_on")?.data).toEqual({ entity_id: "media_player.home_theatre" });
  });

  it("does not wake a device that is already awake", async () => {
    await POST(play(0));

    expect(services()).not.toContain("turn_on");
  });

  it("sends the preset's own shuffle and repeat, with endless asking for repeat-all", async () => {
    host.playlists = [{ name: "Party", icon: "flame", shuffle: true, repeat: "infinite" }];

    await POST(play(0));

    expect(call("shuffle_set")?.data).toEqual({ entity_id: "media_player.home_theatre", shuffle: true });
    // The television has no endless mode to ask for; pyatv knows off/all/track.
    expect(call("repeat_set")?.data).toEqual({ entity_id: "media_player.home_theatre", repeat: "all" });
    expect(host.commands[0]).toEqual({ name: "Party", repeat: "infinite", shuffle: true });
  });

  it("reads the preset from the stored list, so its position means what the dial shows", async () => {
    host.playlists = [{ name: "Cool", icon: null, shuffle: false, repeat: "all" }];

    const response = await POST(play(0));

    expect((await response.json()).name).toBe("Cool");
    expect(call("repeat_set")?.data.repeat).toBe("all");
  });

  it("treats a playback mode the television refuses as best effort, not a failed press", async () => {
    host.failAt = "repeat_set";

    const response = await POST(play(0));

    // The app still has its command, so the preset still plays.
    expect(response.status).toBe(200);
    expect(host.commands).toHaveLength(1);
    expect(attributeControl).toHaveBeenCalledTimes(1);
  });

  it("leaves nothing behind when the app could not be brought forward, and reports it", async () => {
    host.failAt = "play_media";

    const response = await POST(play(0));

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("Home Assistant refused it");
    expect(host.commands).toHaveLength(0);
    expect(attributeControl).not.toHaveBeenCalled();
  });

  it("refuses a position with no preset rather than playing something else", async () => {
    host.playlists = [];
    const response = await POST(play(3));

    expect(response.status).toBe(400);
    expect(host.calls).toHaveLength(0);
    expect(host.commands).toHaveLength(0);
  });

  it("refuses a body that is not a preset position", async () => {
    for (const index of [undefined, null, -1, 1.5, "0"]) {
      const response = await POST(play(index));
      expect(response.status, JSON.stringify(index)).toBe(400);
    }
    const notJson = await POST(new Request("http://localhost/api/appletv/play", { body: "{", method: "POST" }));
    expect(notJson.status).toBe(400);
    expect(host.calls).toHaveLength(0);
  });

  it("reports a missing Apple TV rather than guessing one", async () => {
    host.sourceEntityId = undefined;

    const response = await POST(play(0));

    expect(response.status).toBe(503);
    expect(host.calls).toHaveLength(0);
    expect(host.commands).toHaveLength(0);
  });
});
