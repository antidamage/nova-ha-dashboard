import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdvancedFold } from "../AdvancedFold";
import { fakeFoldGeometry } from "../advancedFoldTesting";
import { drag, matchWide, renderFold } from "./AdvancedFold.fixtures";

describe("AdvancedFold", () => {
  beforeEach(() => {
    matchWide(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps travel made between the break and React's commit", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    act(() => {
      fireEvent.mouseDown(fold, { button: 0, clientX: 300, clientY: 300 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 200 });
      // Breaks here; the open region has not committed yet inside this act.
      fireEvent.mouseMove(window, { clientX: 300, clientY: 130 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 90 });
    });
    fireEvent.mouseUp(window);
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(210);
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

    drag(screen.getByText("inner row"), 200);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe("");

    // A container that cannot scroll along the axis does not own the drag.
    drag(screen.getByText("short row"), 200);
    expect(fold.dataset.open).toBe("true");
  });

  it("leaves only the cross-axis pan to the browser, open or closed", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    fireEvent.scroll(fold);
    expect(fold.style.touchAction).toBe("pan-x");
    drag(fold, 180);
    expect(fold.dataset.open).toBe("true");
    expect(fold.style.touchAction).toBe("pan-x");
  });

  it("does not pull from a drag that starts on a button, and a tap stays a tap", () => {
    const onClick = vi.fn();
    const { container } = render(
      <AdvancedFold advanced={<p>Advanced detail</p>}>
        <h3>Heading</h3>
        <button type="button" onClick={onClick}>On</button>
      </AdvancedFold>,
    );
    const fold = container.querySelector(".advanced-fold") as HTMLElement;
    const track = container.querySelector(".advanced-fold-track") as HTMLElement;
    fakeFoldGeometry(fold);
    drag(screen.getByRole("button", { name: "On" }), 200);
    expect(fold.dataset.open).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    // A press that moves less than the threshold does not move the band.
    fireEvent.mouseDown(screen.getByText("Heading"), { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 295 });
    expect(track.style.transform).toBe("");
    fireEvent.mouseUp(window);
    // A heading starts one.
    drag(screen.getByText("Heading"), 180);
    expect(fold.dataset.open).toBe("true");
  });

  it("drives touch from the default view's text, opening and closing", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    const touchDrag = (target: HTMLElement, pixels: number) => {
      const point = (y: number) => ({ touches: [{ clientX: 300, clientY: y }] });
      fireEvent.touchStart(target, point(300));
      for (let i = 1; i <= 6; i += 1) fireEvent.touchMove(target, point(300 - (pixels * i) / 6));
      fireEvent.touchEnd(target, { touches: [] });
    };
    touchDrag(screen.getByText("Default view"), 120);
    expect(fold.dataset.open).toBe("false");
    touchDrag(screen.getByText("Default view"), 180);
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(180);
    // Back past the boundary from inside Advanced closes it.
    touchDrag(screen.getByText("Advanced detail"), -240);
    expect(fold.dataset.open).toBe("false");
  });
});
