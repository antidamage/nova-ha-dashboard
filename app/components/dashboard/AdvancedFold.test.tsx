import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADVANCED_FOLD_SNAP_PX, AdvancedFold } from "./AdvancedFold";

// Landscape, so the fold runs down the column.
function matchWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function renderFold() {
  return render(
    <AdvancedFold advanced={<p>Advanced detail</p>}>
      <p>Default view</p>
    </AdvancedFold>,
  );
}

function pull(node: HTMLElement, pixels: number) {
  fireEvent.pointerDown(node, { pointerType: "mouse", button: 0, clientX: 0, clientY: 200 });
  fireEvent.pointerMove(node, { pointerType: "mouse", clientX: 0, clientY: 200 - pixels });
}

describe("AdvancedFold", () => {
  beforeEach(() => {
    matchWide(true);
  });

  it("hides the advanced content until the snap is passed", () => {
    const { container } = renderFold();
    const fold = container.querySelector(".advanced-fold") as HTMLElement;

    expect(screen.getByText("Default view")).toBeTruthy();
    expect(screen.queryByText("Advanced detail")).toBeNull();

    pull(fold, ADVANCED_FOLD_SNAP_PX - 5);
    expect(screen.queryByText("Advanced detail")).toBeNull();

    fireEvent.pointerUp(fold);
    pull(fold, ADVANCED_FOLD_SNAP_PX + 1);
    expect(screen.getByText("Advanced detail")).toBeTruthy();
    expect(fold.dataset.open).toBe("true");
  });

  it("locks again when the scroller returns to the top", () => {
    const { container } = renderFold();
    const fold = container.querySelector(".advanced-fold") as HTMLElement;

    pull(fold, ADVANCED_FOLD_SNAP_PX + 1);
    expect(fold.dataset.open).toBe("true");

    fold.scrollTop = 0;
    fireEvent.scroll(fold);
    expect(fold.dataset.open).toBe("false");
    expect(screen.queryByText("Advanced detail")).toBeNull();
  });

  it("runs sideways in portrait", () => {
    matchWide(false);
    const { container } = renderFold();
    const fold = container.querySelector(".advanced-fold") as HTMLElement;

    expect(fold.dataset.axis).toBe("x");
    fireEvent.pointerDown(fold, { pointerType: "mouse", button: 0, clientX: 200, clientY: 0 });
    fireEvent.pointerMove(fold, { pointerType: "mouse", clientX: 200 - (ADVANCED_FOLD_SNAP_PX + 1), clientY: 0 });
    expect(screen.getByText("Advanced detail")).toBeTruthy();
  });
});
