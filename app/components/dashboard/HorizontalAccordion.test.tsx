import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HorizontalAccordion } from "./HorizontalAccordion";

describe("zone accordion", () => {
  let wide = true;
  let subscribers: Set<() => void>;

  beforeEach(() => {
    wide = true;
    subscribers = new Set();
    window.sessionStorage.clear();
    vi.stubGlobal("matchMedia", () => ({
      matches: wide,
      addEventListener: (_: string, listener: () => void) => subscribers.add(listener),
      removeEventListener: (_: string, listener: () => void) => subscribers.delete(listener),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  const menu = () => <HorizontalAccordion title="Home" persistKey="test-home"><button>Bedroom</button></HorizontalAccordion>;

  it("hides the collapsed menu from navigation, retaining the trigger on expand and collapse", () => {
    render(menu());
    const trigger = screen.getByRole("button", { name: "Home zones" });
    expect(screen.queryByRole("button", { name: "Bedroom" })).toBeNull();
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Bedroom" })).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Bedroom" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("remembers each group's state independently across remounts", () => {
    const first = render(menu());
    fireEvent.click(screen.getByRole("button", { name: "Home zones" }));
    first.unmount();
    render(<>{menu()}<HorizontalAccordion title="Systems" persistKey="test-systems">Systems content</HorizontalAccordion></>);
    expect(screen.getByRole("button", { name: "Home zones" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Systems zones" })).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses in portrait too, sharing the open/closed state across a rotation", () => {
    render(menu());
    act(() => { wide = false; subscribers.forEach((change) => change()); });
    const trigger = screen.getByRole("button", { name: "Home zones" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Bedroom" })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Bedroom" })).toBeVisible();
    act(() => { wide = true; subscribers.forEach((change) => change()); });
    expect(screen.getByRole("button", { name: "Bedroom" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Home zones" })).toHaveAttribute("aria-expanded", "true");
  });

  it("points the chevron by orientation: left/right in landscape, down/right in portrait", () => {
    const { container } = render(menu());
    const icon = () => container.querySelector(".horizontal-accordion-indicator svg")?.getAttribute("class") ?? "";
    expect(icon()).toMatch(/chevron-right/);
    fireEvent.click(screen.getByRole("button", { name: "Home zones" }));
    expect(icon()).toMatch(/chevron-left/);
    act(() => { wide = false; subscribers.forEach((change) => change()); });
    expect(icon()).toMatch(/chevron-down/);
    fireEvent.click(screen.getByRole("button", { name: "Home zones" }));
    expect(icon()).toMatch(/chevron-right/);
  });

  const joined = (attachKey: string | null, owns: boolean) => (
    <HorizontalAccordion title="Home" persistKey="test-home" attachKey={attachKey} attached={owns ? <p>Bedroom controls</p> : null}>
      <button>Bedroom</button>
    </HorizontalAccordion>
  );

  it("joins the selected zone's controls to the open entry in both orientations", () => {
    const view = render(joined("bedroom", true));
    expect(screen.queryByText("Bedroom controls")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Home zones" }));
    expect(screen.getByText("Bedroom controls").parentElement).toHaveClass("horizontal-accordion-attached");
    view.rerender(joined("climate", false));
    expect(screen.queryByText("Bedroom controls")).toBeNull();
    act(() => { wide = false; subscribers.forEach((change) => change()); });
    view.rerender(joined("bedroom", true));
    const attached = screen.getByText("Bedroom controls").parentElement!;
    expect(attached).toHaveClass("horizontal-accordion-attached");
    // Below the list, inside the same card.
    expect(attached.previousElementSibling).toHaveClass("horizontal-accordion-content");
    fireEvent.click(screen.getByRole("button", { name: "Home zones" }));
    expect(screen.queryByText("Bedroom controls")).toBeNull();
  });

  it("opens a closed entry when the selection moves into it, but not on first load", () => {
    const view = render(joined("", false));
    view.rerender(joined("bedroom", true));
    expect(screen.getByRole("button", { name: "Home zones" })).toHaveAttribute("aria-expanded", "false");
    view.rerender(joined("climate", false));
    view.rerender(joined("lounge", true));
    expect(screen.getByRole("button", { name: "Home zones" })).toHaveAttribute("aria-expanded", "true");
  });
});
