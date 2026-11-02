import { afterEach, describe, expect, it, vi } from "vitest";
import { proxySmoothRequest } from "./smooth-proxy";

const get = () => new Request("http://dashboard.test/x");

afterEach(() => vi.unstubAllGlobals());

describe("proxySmoothRequest", () => {
  it("refuses anything but the playlist and segments", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of [["status"], ["..", "index.m3u8"], ["seg_abc.ts"], [], ["index.m3u8", "x"]]) {
      expect((await proxySmoothRequest(get(), path)).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
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
