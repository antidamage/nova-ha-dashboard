import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoFullscreen } from "./useAutoFullscreen";

const requestDashboardFullscreenMock = vi.hoisted(() => vi.fn());

vi.mock("./shell", () => ({
  requestDashboardFullscreen: requestDashboardFullscreenMock,
}));

function AutoFullscreenHarness({
  enabled = true,
}: {
  enabled?: boolean;
}) {
  useAutoFullscreen(enabled);
  return null;
}

async function flushFullscreenRequest() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("useAutoFullscreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestDashboardFullscreenMock.mockReset();
    requestDashboardFullscreenMock.mockResolvedValue(undefined);
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibilityState("visible");
  });

  it("checks fullscreen on mount, page load, common events, and a minute interval", async () => {
    render(<AutoFullscreenHarness />);

    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(1);
    await flushFullscreenRequest();

    window.dispatchEvent(new Event("load"));
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(2);
    await flushFullscreenRequest();

    window.dispatchEvent(new Event("focus"));
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(3);
    await flushFullscreenRequest();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(4);
    await flushFullscreenRequest();

    document.dispatchEvent(new Event("click"));
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(5);
    await flushFullscreenRequest();

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(6);
  });

  it("does not request fullscreen when the setting is disabled", () => {
    render(<AutoFullscreenHarness enabled={false} />);
    expect(requestDashboardFullscreenMock).not.toHaveBeenCalled();
  });

  it("skips fullscreen checks while the page is hidden", () => {
    setVisibilityState("hidden");

    render(<AutoFullscreenHarness />);

    expect(requestDashboardFullscreenMock).not.toHaveBeenCalled();
  });

  it("does not overlap fullscreen requests when events arrive together", async () => {
    let resolveRequest: (() => void) | null = null;
    requestDashboardFullscreenMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));

    render(<AutoFullscreenHarness />);

    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("keydown"));
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.();
      await Promise.resolve();
    });

    window.dispatchEvent(new Event("focus"));
    expect(requestDashboardFullscreenMock).toHaveBeenCalledTimes(2);
  });
});
