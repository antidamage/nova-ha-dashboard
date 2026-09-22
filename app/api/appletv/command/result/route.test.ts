import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  written: [] as Array<{ id: number; name: string; played: boolean; reason?: string | null }>,
  calls: [] as Array<{ data: Record<string, unknown>; service: string }>,
  refused: false,
  configFails: false,
}));

vi.mock("../../../../../lib/appletv-command", () => ({
  writePlayResult: vi.fn(async (result: { id: number; name: string; played: boolean; reason?: string | null }) => {
    host.written.push(result);
    return { at: "2026-09-22T00:00:00.000Z", ...result, reason: result.reason ?? null };
  }),
}));

vi.mock("../../../../../lib/dashboard-config", () => ({
  readDashboardConfig: async () => {
    if (host.configFails) throw new Error("Dashboard config is invalid: power.ampPowerControl.sourceEntityId: expected string");
    return { power: { ampPowerControl: { sourceEntityId: "media_player.home_theatre" } } };
  },
}));

vi.mock("../../../../../lib/ha/client", () => ({
  callService: vi.fn(async (_domain: string, service: string, data: Record<string, unknown>) => {
    if (host.refused) throw new Error("Home Assistant refused it");
    host.calls.push({ data, service });
    return [];
  }),
}));

const { POST } = await import("./route");

function report(body: unknown) {
  return new Request("http://localhost/api/appletv/command/result", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

describe("/api/appletv/command/result", () => {
  beforeEach(() => {
    host.written = [];
    host.calls = [];
    host.refused = false;
    host.configFails = false;
    vi.clearAllMocks();
  });

  it("records that the preset played", async () => {
    const response = await POST(report({ id: 3, name: "Excellent", played: true }));

    expect(response.status).toBe(200);
    expect(host.written).toEqual([{ id: 3, name: "Excellent", played: true, reason: null }]);
  });

  it("records why it did not, in the app's own words", async () => {
    const response = await POST(report({ id: 4, name: "Snake", played: false, reason: "NO PLAYLIST NAMED SNAKE" }));

    expect(response.status).toBe(200);
    expect(host.written[0].reason).toBe("NO PLAYLIST NAMED SNAKE");
  });

  it("puts Apple Music on screen once the playlist is playing", async () => {
    // Adeline, 2026-09-22: not through our own app — the television should show
    // Apple Music playing the playlist, and our app has done its job by now.
    const response = await POST(report({ id: 3, name: "Excellent", played: true }));

    expect(response.status).toBe(200);
    // The answer does not wait for the screen, so the effect is waited for here.
    await vi.waitFor(() =>
      expect(host.calls).toEqual([
        {
          data: {
            entity_id: "media_player.home_theatre",
            media_content_id: "com.apple.TVMusic",
            media_content_type: "app",
          },
          service: "play_media",
        },
      ]),
    );
  });

  it("leaves the screen alone when the preset played nothing", async () => {
    await POST(report({ id: 4, name: "Snake", played: false, reason: "NO PLAYLIST NAMED SNAKE" }));

    expect(host.calls).toHaveLength(0);
  });

  it("still answers with the report when Apple Music cannot be brought forward", async () => {
    host.refused = true;

    const response = await POST(report({ id: 5, name: "Excellent", played: true }));

    // The television's answer landed; a refusal bringing the screen forward is
    // not a failed press.
    expect(response.status).toBe(200);
    expect(host.written).toHaveLength(1);
  });

  it("still answers with the report when the dashboard config cannot be read", async () => {
    host.configFails = true;

    const response = await POST(report({ id: 6, name: "Excellent", played: true }));

    // The record is the television's answer. A config that will not read is a
    // reason not to move the screen, never a reason to fail a report that landed.
    expect(response.status).toBe(200);
    expect(host.written).toHaveLength(1);
  });

  it("refuses a report that is not one, writing nothing", async () => {
    for (const body of [{}, { id: 1 }, { id: 1, name: "", played: true }, { id: 1, name: "x", played: "yes" }, { id: 1, name: "x", played: false, reason: 7 }]) {
      const response = await POST(report(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const notJson = await POST(new Request("http://localhost/api/appletv/command/result", { body: "{", method: "POST" }));
    expect(notJson.status).toBe(400);
    expect(host.written).toHaveLength(0);
  });
});
