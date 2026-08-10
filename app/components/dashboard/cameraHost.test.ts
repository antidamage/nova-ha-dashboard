import { beforeEach, describe, expect, it } from "vitest";
import { cameraHostBase, cameraUrl, normalizeVideoHost } from "./cameraHost";

declare global {
  interface Window {
    __NOVA_VIDEO_HOST__?: unknown;
  }
}

beforeEach(() => {
  delete window.__NOVA_VIDEO_HOST__;
});

describe("cameraHost", () => {
  it("normalizes configured hosts without changing their scheme", () => {
    expect(normalizeVideoHost("  http://nocturnium.local:8080/// ")).toBe("http://nocturnium.local:8080");
    expect(normalizeVideoHost(null)).toBe("");
  });

  it("keeps remote camera traffic on Nova's secure same origin", () => {
    window.__NOVA_VIDEO_HOST__ = "http://nocturnium.local:8080";

    expect(cameraHostBase()).toBe("http://nocturnium.local:8080");
    expect(cameraUrl("outside", "index.m3u8")).toBe("/api/camera-proxy/outside/index.m3u8");
    expect(cameraUrl("outside", "snapshots/capture.mp4")).toBe(
      "/api/camera-proxy/outside/snapshots/capture.mp4",
    );
  });

  it("uses the local recorder when no remote host is configured", () => {
    expect(cameraUrl("outside", "status")).toBe("/api/camera/outside/status");
  });

  it("uses the proxy immediately after a host is saved, before a reload updates the bootstrap", () => {
    expect(cameraUrl("outside", "settings", "http://nocturnium.local:8080")).toBe(
      "/api/camera-proxy/outside/settings",
    );
  });
});
