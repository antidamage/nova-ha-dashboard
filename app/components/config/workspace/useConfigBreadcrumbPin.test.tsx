import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useConfigBreadcrumbPin } from "./useConfigBreadcrumbPin";

// jsdom has no layout, so the two rectangles this hook compares are stubbed on
// the prototype and told apart by class.
const originalRect = Element.prototype.getBoundingClientRect;

function stubTops({ slot, cluster }: { slot: number; cluster: number }) {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const top = this.classList.contains("config-breadcrumb-slot")
      ? slot
      : this.classList.contains("dashboard-reload-link")
        ? cluster
        : 0;
    return {
      top,
      bottom: top,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function Harness() {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useConfigBreadcrumbPin(slotRef);
  return (
    <main className="dashboard-shell">
      <button type="button" className="dashboard-reload-link" />
      <div className="config-layout">
        <div className="config-breadcrumb-slot" ref={slotRef} />
      </div>
    </main>
  );
}

describe("useConfigBreadcrumbPin", () => {
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  it("holds the resting state until the row reaches the cluster's line", () => {
    stubTops({ slot: 200, cluster: 16 });
    const { container } = render(<Harness />);

    expect(container.querySelector(".dashboard-shell")?.getAttribute("data-nova-trail")).toBe("resting");
  });

  it("pins once the row is level with the cluster, and rests again on the way back", async () => {
    stubTops({ slot: 200, cluster: 16 });
    const { container } = render(<Harness />);
    const shell = container.querySelector(".dashboard-shell");

    stubTops({ slot: 16, cluster: 16 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(shell?.getAttribute("data-nova-trail")).toBe("pinned"));

    stubTops({ slot: 300, cluster: 16 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(shell?.getAttribute("data-nova-trail")).toBe("resting"));
  });

  it("clears the switch on unmount, so a later page cannot inherit it", () => {
    stubTops({ slot: 200, cluster: 16 });
    const { container, unmount } = render(<Harness />);
    const shell = container.querySelector(".dashboard-shell");
    expect(shell?.getAttribute("data-nova-trail")).toBe("resting");

    unmount();
    expect(shell?.getAttribute("data-nova-trail")).toBeNull();
  });
});
