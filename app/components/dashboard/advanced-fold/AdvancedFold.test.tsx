import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bandDisplacement } from "../advancedFoldBand";
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
    expect(track!.style.transform).toBe(`translateY(${-bandDisplacement(60, "drag")}px)`);
    expect(track!.style.transition).toBe("none");

    fireEvent.mouseUp(window);
    expect(track!.style.transform).toBe("none");
    expect(track!.style.transition).toContain("180ms");
    expect(screen.queryByText("Advanced detail")).toBeNull();
  });

  it("holds a 120px drag closed, breaks at 160px and lands on the 1:1 offset", () => {
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    drag(fold, 120);
    expect(fold.dataset.open).toBe("false");
    drag(fold, 180);
    expect(fold.dataset.open).toBe("true");
    expect(screen.getByText("Advanced detail")).toBeTruthy();
    expect(fold.scrollTop).toBe(180);
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
    drag(fold, 180);
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(330);

    // Back to the boundary re-locks.
    fold.scrollTop = 150;
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("false");
  });

  it("closes when the user scrolls back to the boundary, and resists again", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold);
    drag(fold, 180);
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
    expect(track!.style.transform).toBe(`translateY(${-bandDisplacement(40, "drag")}px)`);
    fireEvent.mouseUp(window);
  });

  it("does not close when Advanced's own content shrinks and clamps the offset", () => {
    const { fold } = renderFold();
    const geometry = fakeFoldGeometry(fold);
    drag(fold, 180);
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
    drag(fold, 200);
    expect(fold.dataset.open).toBe("false");
  });

  it("does not pull from a drag that starts on a knob or its toggle ring", () => {
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold);
    drag(screen.getByText("face"), 200);
    expect(fold.dataset.open).toBe("false");
    drag(screen.getByRole("switch"), 200);
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).toBe("");
  });
});
