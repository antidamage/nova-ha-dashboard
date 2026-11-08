import { describe, expect, it, vi } from "vitest";
import { normalizeDailyTasksUrl, readDailyTasksCount } from "./count";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("normalizeDailyTasksUrl", () => {
  it("keeps http(s) URLs and ends them in a slash", () => {
    expect(normalizeDailyTasksUrl(" https://example.test/tasks ")).toBe("https://example.test/tasks/");
    expect(normalizeDailyTasksUrl("http://example.test/tasks/?x=1#y")).toBe("http://example.test/tasks/");
  });

  it("drops anything else", () => {
    for (const value of ["", "   ", "ftp://example.test/", "javascript:alert(1)", "not a url", 7, null]) {
      expect(normalizeDailyTasksUrl(value)).toBe("");
    }
  });
});

describe("readDailyTasksCount", () => {
  it("is unconfigured, and fetches nothing, without an address", async () => {
    const fetchImpl = vi.fn();
    expect(await readDailyTasksCount("", fetchImpl)).toEqual({ configured: false, unfinished: null, url: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads api/count under the configured address", async () => {
    const fetchImpl = vi.fn(async () => json({ unfinished: 0, day: "2026-11-08" }));
    const result = await readDailyTasksCount("https://example.test/tasks", fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ configured: true, unfinished: 0, url: "https://example.test/tasks/" });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe("https://example.test/tasks/api/count");
  });

  it("reports an unreadable site as a null count", async () => {
    const failing = vi.fn(async () => { throw new Error("down"); });
    const bad = vi.fn(async () => json({ unfinished: "three" }));
    const missing = vi.fn(async () => json({}, 502));
    for (const fetchImpl of [failing, bad, missing]) {
      expect((await readDailyTasksCount("https://example.test/tasks/", fetchImpl as unknown as typeof fetch)).unfinished).toBeNull();
    }
  });
});
