import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  written: [] as Array<{ id: number; name: string; played: boolean; reason?: string | null }>,
}));

vi.mock("../../../../../lib/appletv-command", () => ({
  writePlayResult: vi.fn(async (result: { id: number; name: string; played: boolean; reason?: string | null }) => {
    host.written.push(result);
    return { at: "2026-09-22T00:00:00.000Z", ...result, reason: result.reason ?? null };
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
