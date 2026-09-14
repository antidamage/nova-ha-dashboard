import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedFold } from "./AdvancedFold";
import { bandDisplacement } from "./advancedFoldBand";
import { fakeFoldGeometry } from "./advancedFoldTesting";

function matchWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("aspect-ratio") ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function renderFold(advanced: ReactNode = <p>Advanced detail</p>) {
  const view = render(
    <AdvancedFold advanced={advanced}>
      <p>Default view</p>
      <div role="slider" aria-label="Knob"><span>face</span></div>
      <div role="switch" aria-checked="false" aria-label="Ring" />
    </AdvancedFold>,
  );
  const fold = view.container.querySelector(".advanced-fold") as HTMLElement;
  const track = view.container.querySelector(".advanced-fold-track") as HTMLElement | null;
  return { ...view, fold, track };
}

/** A mouse drag toward Advanced by `pixels` along the fold's axis. */
function drag(target: HTMLElement, pixels: number, axis: "x" | "y" = "y", release = true) {
  fireEvent.mouseDown(target, { button: 0, clientX: 300, clientY: 300 });
  const step = pixels / 4;
  for (let i = 1; i <= 4; i += 1) {
    fireEvent.mouseMove(window, axis === "y"
      ? { clientX: 300, clientY: 300 - step * i }
      : { clientX: 300 - step * i, clientY: 300 });
  }
  if (release) fireEvent.mouseUp(window);
}

describe("AdvancedFold", () => {
  beforeEach(() => {
    matchWide(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("without advanced content is a plain scroller: no divider, no gesture", () => {
    const { container, fold } = renderFold(null);
    expect(fold.dataset.foldless).toBe("true");
    expect(container.querySelector(".advanced-fold-divider")).toBeNull();
    fakeFoldGeometry(fold);
    expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(true);
    drag(fold, 120);
    expect(fold.dataset.open).toBeUndefined();
    expect(fold.scrollTop).toBe(0);
  });

  it("resists a 60px pull, stays closed and springs back", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold);

    drag(fold, 60, "y", false);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe(`translateY(${-bandDisplacement(60)}px)`);
    expect(track!.style.transition).toBe("none");

    fireEvent.mouseUp(window);
    expect(track!.style.transform).toBe("none");
    expect(track!.style.transition).toContain("180ms");
    expect(screen.queryByText("Advanced detail")).toBeNull();
  });

  it("breaks at 80px and lands on the 1:1 offset", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    drag(fold, 100);
    expect(fold.dataset.open).toBe("true");
    expect(screen.getByText("Advanced detail")).toBeTruthy();
    expect(fold.scrollTop).toBe(100);
  });

  it("engages only at the boundary of a default view taller than the panel", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold, { client: 300, closed: 450 });

    // Scrolls freely through the default view first.
    fold.scrollTop = 100;
    fireEvent.scroll(fold);
    expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(true);
    drag(fold, 40, "y", false);
    expect(fold.scrollTop).toBe(140);
    expect(track!.style.transform).toBe("");
    fireEvent.mouseUp(window);

    fold.scrollTop = 150;
    fireEvent.scroll(fold);
    drag(fold, 100);
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(250);

    // Back to the boundary re-locks.
    fold.scrollTop = 150;
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("false");
  });

  it("closes when the user scrolls back to the boundary, and resists again", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold);
    drag(fold, 100);
    expect(fold.dataset.open).toBe("true");
    // The break's own write is not a return.
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("true");

    fold.scrollTop = 0;
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("false");
    expect(screen.queryByText("Advanced detail")).toBeNull();

    drag(fold, 40, "y", false);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe(`translateY(${-bandDisplacement(40)}px)`);
    fireEvent.mouseUp(window);
  });

  it("does not close when Advanced's own content shrinks and clamps the offset", () => {
    const { fold } = renderFold();
    const geometry = fakeFoldGeometry(fold);
    drag(fold, 100);
    fold.scrollTop = 500;
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("true");

    geometry.setAdvanced(0);
    fireEvent.scroll(fold);
    expect(fold.scrollTop).toBe(0);
    expect(fold.dataset.open).toBe("true");
  });

  it("does not open when there is nothing past the boundary", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold, { advanced: 0 });
    drag(fold, 120);
    expect(fold.dataset.open).toBe("false");
  });

  it("does not pull from a drag that starts on a knob or its toggle ring", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold);
    drag(screen.getByText("face"), 120);
    expect(fold.dataset.open).toBe("false");
    drag(screen.getByRole("switch"), 120);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe("");
  });

  it("counts the wheel at a quarter: three 100px notches stay closed, four open", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    for (let i = 0; i < 3; i += 1) expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(false);
    expect(fold.dataset.open).toBe("false");
    act(() => {
      vi.advanceTimersByTime(450);
    });

    for (let i = 0; i < 3; i += 1) fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
    fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(100);
  });

  it("lets the pull decay when the wheel stops for 400ms", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    fireEvent.wheel(fold, { deltaY: 100 });
    fireEvent.wheel(fold, { deltaY: 100 });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.wheel(fold, { deltaY: 100 });
    fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
  });

  it("judges the wheel's pause by event time, not by a timer a busy page ran early", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    const wheelAt = (time: number) => act(() => {
      const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: time });
      fold.dispatchEvent(event);
    });

    wheelAt(10_000);
    wheelAt(10_100);
    // The timer runs before the next notch, which was queued 100ms later.
    act(() => {
      vi.advanceTimersByTime(450);
    });
    wheelAt(10_200);
    expect(fold.dataset.open).toBe("false");
    wheelAt(10_300);
    expect(fold.dataset.open).toBe("true");
  });

  it("runs sideways in portrait and ignores a vertical wheel there", () => {
    matchWide(false);
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    expect(fold.dataset.axis).toBe("x");

    for (let i = 0; i < 6; i += 1) expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(true);
    expect(fold.dataset.open).toBe("false");

    drag(fold, 100, "x");
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollLeft).toBe(100);
  });

  it("lets the band go after a wheel break with nothing to open onto", () => {
    vi.useFakeTimers();
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold, { advanced: 0 });

    for (let i = 0; i < 4; i += 1) fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).not.toBe("");
    expect(track!.style.transform).not.toBe("none");

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(fold.dataset.open).toBe("false");
    expect(["", "none"]).toContain(track!.style.transform);
  });

  it("keeps travel made between the break and React's commit", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    act(() => {
      fireEvent.mouseDown(fold, { button: 0, clientX: 300, clientY: 300 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 240 });
      // Breaks here; the open region has not committed yet inside this act.
      fireEvent.mouseMove(window, { clientX: 300, clientY: 210 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 170 });
    });
    fireEvent.mouseUp(window);
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(130);
  });

  it("does not pull from a drag that starts inside a scroller of its own", () => {
    const { container } = render(
      <AdvancedFold advanced={<p>Advanced detail</p>}>
        <div data-testid="inner" style={{ overflowY: "auto" }}>
          <span>inner row</span>
        </div>
        <div data-testid="still" style={{ overflowY: "auto" }}>
          <span>short row</span>
        </div>
      </AdvancedFold>,
    );
    const fold = container.querySelector(".advanced-fold") as HTMLElement;
    const track = container.querySelector(".advanced-fold-track") as HTMLElement;
    fakeFoldGeometry(fold);
    const inner = screen.getByTestId("inner");
    Object.defineProperty(inner, "scrollHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(inner, "clientHeight", { configurable: true, get: () => 100 });

    drag(screen.getByText("inner row"), 120);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe("");

    // A container that cannot scroll along the axis does not own the drag.
    drag(screen.getByText("short row"), 120);
    expect(fold.dataset.open).toBe("true");
  });

  it("sets touch-action for the next gesture while locked at the boundary", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    fireEvent.scroll(fold);
    expect(fold.style.touchAction).toBe("pan-x");
  });
});
