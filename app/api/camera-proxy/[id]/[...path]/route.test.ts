import { afterEach, describe, expect, it, vi } from "vitest";
import { readDashboardConfig } from "../../../../../lib/dashboard-config";
import { GET, PUT } from "./route";

vi.mock("../../../../../lib/dashboard-config", () => ({
  readDashboardConfig: vi.fn(),
}));

const readConfigMock = vi.mocked(readDashboardConfig);

function context(path: string[]) {
  return { params: Promise.resolve({ id: "outside", path }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("same-origin camera proxy", () => {
  it("relays an HLS request to the configured HTTP capture host server-side", async () => {
    readConfigMock.mockResolvedValue({
      dashboard: { camera: { outside: { videoHostUrl: "http://nocturnium.local:8080" } } },
    } as Awaited<ReturnType<typeof readDashboardConfig>>);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("#EXTM3U", {
        status: 200,
        headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
      }),
    );

    const response = await GET(
      new Request("https://nova.local/api/camera-proxy/outside/index.m3u8?_=123"),
      context(["index.m3u8"]),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://nocturnium.local:8080/camera/outside/index.m3u8?_=123");
    expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");
    expect(await response.text()).toBe("#EXTM3U");
  });

  it("forwards settings writes without exposing a client-selected target", async () => {
    readConfigMock.mockResolvedValue({
      dashboard: { camera: { outside: { videoHostUrl: "http://nocturnium.local:8080" } } },
    } as Awaited<ReturnType<typeof readDashboardConfig>>);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ brightness: 0 }, { status: 200 }),
    );

    const response = await PUT(
      new Request("https://nova.local/api/camera-proxy/outside/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brightness: 0 }),
      }),
      context(["settings"]),
    );

    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://nocturnium.local:8080/camera/outside/settings");
    expect(init?.method).toBe("PUT");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"brightness":0}');
    expect(response.status).toBe(200);
  });

  it("fails closed when no valid remote host is configured", async () => {
    readConfigMock.mockResolvedValue({
      dashboard: { camera: { outside: { videoHostUrl: "javascript:alert(1)" } } },
    } as Awaited<ReturnType<typeof readDashboardConfig>>);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(
      new Request("https://nova.local/api/camera-proxy/outside/status"),
      context(["status"]),
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
