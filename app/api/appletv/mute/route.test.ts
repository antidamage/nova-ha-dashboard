import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  calls: [] as Array<{ data: Record<string, unknown>; service: string }>,
  sourceEntityId: "media_player.home_theatre" as string | undefined,
  refuse: false,
}));

vi.mock("../../../../lib/ha/client", () => ({
  callService: vi.fn(async (_domain: string, service: string, data: Record<string, unknown>) => {
    if (host.refuse) throw new Error("Home Assistant refused it");
    host.calls.push({ data, service });
    return [];
  }),
}));

vi.mock("../../../../lib/dashboard-config", () => ({
  readDashboardConfig: async () => ({ power: { ampPowerControl: { sourceEntityId: host.sourceEntityId } } }),
}));

vi.mock("../../../../lib/control-attribution", () => ({ attributeControl: vi.fn(async () => undefined) }));

const { POST } = await import("./route");
const { attributeControl } = await import("../../../../lib/control-attribution");

function mute(body: unknown) {
  return new Request("http://localhost/api/appletv/mute", { body: JSON.stringify(body), method: "POST" });
}

describe("/api/appletv/mute", () => {
  beforeEach(() => {
    host.calls = [];
    host.sourceEntityId = "media_player.home_theatre";
    host.refuse = false;
    vi.clearAllMocks();
  });

  it("mutes by taking the Apple TV to zero, because it has no mute to ask for", async () => {
    const response = await POST(mute({ level: 42, muted: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entity: "media_player.home_theatre", level: 0, muted: true });
    expect(host.calls).toEqual([{ data: { entity_id: "media_player.home_theatre", volume_level: 0 }, service: "volume_set" }]);
    expect(attributeControl).toHaveBeenCalledTimes(1);
  });

  it("unmutes to the level the dial was holding", async () => {
    const response = await POST(mute({ level: 42, muted: false }));

    expect(await response.json()).toEqual({ entity: "media_player.home_theatre", level: 42, muted: false });
    expect(host.calls[0].data.volume_level).toBeCloseTo(0.42);
    expect(attributeControl).toHaveBeenCalledTimes(1);
  });

  it("rounds a fractional reading, which is what the dial can hold", async () => {
    await POST(mute({ level: 41.6, muted: false }));

    expect(host.calls[0].data.volume_level).toBeCloseTo(0.42);
  });

  it("refuses a body it cannot act on, calling nothing", async () => {
    for (const body of [{}, { muted: true }, { muted: "yes", level: 40 }, { muted: false, level: "40" }, { muted: false, level: -1 }, { muted: false, level: 101 }, { muted: false, level: Number.NaN }]) {
      const response = await POST(mute(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const notJson = await POST(new Request("http://localhost/api/appletv/mute", { body: "{", method: "POST" }));
    expect(notJson.status).toBe(400);
    expect(host.calls).toHaveLength(0);
  });

  it("reports a missing Apple TV rather than guessing one", async () => {
    host.sourceEntityId = undefined;

    expect((await POST(mute({ level: 40, muted: true }))).status).toBe(503);
    expect(host.calls).toHaveLength(0);
  });

  it("reports a refused command, and attributes nothing", async () => {
    host.refuse = true;

    const response = await POST(mute({ level: 40, muted: true }));

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("Home Assistant refused it");
    expect(attributeControl).not.toHaveBeenCalled();
  });
});
