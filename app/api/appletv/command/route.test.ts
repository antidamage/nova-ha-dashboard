import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  pending: null as unknown,
  reads: 0,
}));

vi.mock("../../../../lib/appletv-command", () => ({
  readPendingPlayCommand: vi.fn(async () => {
    host.reads += 1;
    return host.pending;
  }),
}));

const { GET } = await import("./route");

describe("/api/appletv/command", () => {
  beforeEach(() => {
    host.pending = null;
    host.reads = 0;
    vi.clearAllMocks();
  });

  it("hands the app nothing when no preset has been pressed", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ command: null });
    // A poll must not be served from a cache: it is how the app learns of a press.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("hands over the press, whole, for the app to resolve and play", async () => {
    host.pending = { at: "2026-09-22T05:00:00.000Z", id: 7, name: "Sword Smoke & Temple Drums", repeat: "all", shuffle: true };

    const response = await GET();

    expect(await response.json()).toEqual({ command: host.pending });
    expect(host.reads).toBe(1);
  });
});
