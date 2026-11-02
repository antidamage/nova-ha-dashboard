import { afterEach, describe, expect, it, vi } from "vitest";
import { proxySmoothRequest } from "./smooth-proxy";

const get = () => new Request("http://dashboard.test/x");

afterEach(() => vi.unstubAllGlobals());

describe("proxySmoothRequest", () => {
  it("refuses anything but the service's own paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of [
      ["..", "index.m3u8"],
      ["seg_abc.ts"],
      [],
      ["index.m3u8", "x"],
      ["at", "..", "1", "1", "index.m3u8"],
      ["at", "recording", "1", "2", "index.m3u8"],
      ["render", "..", "x.mp4"],
      ["render", "recording.mp4"],
    ]) {
      expect((await proxySmoothRequest(get(), path)).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a position stream through whole", async () => {
    const fetchMock = vi.fn(async () => new Response("#EXTM3U", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await proxySmoothRequest(get(), ["at", "range_12", "4000", "0.5", "seg_000001.ts"]);
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringMatching(/\/at\/range_12\/4000\/0\.5\/seg_000001\.ts$/), expect.anything()]);
  });

  it("names a download, and only with a safe name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("mp4", { status: 200, headers: { "content-type": "video/mp4" } })));
    const named = await proxySmoothRequest(new Request("http://dashboard.test/x?name=outside-1.mp4"), ["render", "range_12.mp4"]);
    expect(named.headers.get("content-disposition")).toBe('attachment; filename="outside-1.mp4"');
    const unsafe = await proxySmoothRequest(new Request('http://dashboard.test/x?name=a"b.mp4'), ["render", "range_12.mp4"]);
    expect(unsafe.headers.get("content-disposition")).toBeNull();
  });

  it("refuses writes", async () => {
    const response = await proxySmoothRequest(new Request("http://dashboard.test/x", { method: "POST" }), ["index.m3u8"]);
    expect(response.status).toBe(405);
  });

  it("relays the service's answer without caching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("#EXTM3U", { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } })));
    const response = await proxySmoothRequest(get(), ["index.m3u8"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("#EXTM3U");
  });

  it("passes on the service's not-ready answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await proxySmoothRequest(get(), ["index.m3u8"])).status).toBe(503);
  });

  it("answers 503 when the service is not running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    expect((await proxySmoothRequest(get(), ["seg_000001.ts"])).status).toBe(503);
  });
});
