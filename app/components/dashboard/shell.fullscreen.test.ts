import { afterEach, describe, expect, it } from "vitest";
import { isDashboardFullscreen, requestDashboardFullscreen } from "./shell";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function setScreen(width: number, height: number) {
  Object.defineProperty(window, "screen", {
    configurable: true,
    value: { ...window.screen, width, height },
  });
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches } as MediaQueryList),
  });
}

describe("isDashboardFullscreen", () => {
  afterEach(() => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("reports fullscreen when the Fullscreen API owns an element", () => {
    setMatchMedia(false);
    setScreen(1080, 1920);
    setViewport(1080, 1080);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.documentElement,
    });

    expect(isDashboardFullscreen()).toBe(true);
  });

  it("reports fullscreen for a browser window opened fullscreen, which has no fullscreenElement", () => {
    setMatchMedia(false);
    setScreen(1080, 1920);
    setViewport(1080, 1920);

    expect(isDashboardFullscreen()).toBe(true);
  });

  it("reports fullscreen when the display-mode media query matches", () => {
    setMatchMedia(true);
    setScreen(1080, 1920);
    setViewport(800, 600);

    expect(isDashboardFullscreen()).toBe(true);
  });

  it("reports windowed when the viewport is smaller than the screen", () => {
    setMatchMedia(false);
    setScreen(1080, 1920);
    setViewport(1080, 1840);

    expect(isDashboardFullscreen()).toBe(false);
  });

  it("does not call the Fullscreen API for an already-fullscreen window", async () => {
    setMatchMedia(false);
    setScreen(1080, 1920);
    setViewport(1080, 1920);

    let requested = false;
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: async () => {
        requested = true;
      },
    });

    await requestDashboardFullscreen();
    expect(requested).toBe(false);
  });
});
