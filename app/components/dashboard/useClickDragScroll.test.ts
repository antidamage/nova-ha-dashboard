import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startsInNonDraggable, useClickDragScroll } from "./useClickDragScroll";

// Which mousedown targets must NOT begin a page pan. jsdom has no layout, so the
// inner-scrollable branch (scrollHeight > clientHeight) can't be exercised here;
// it is covered by the tag/role/opt-out branches plus the e2e drag test.
describe("click-drag: startsInNonDraggable", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mount(html: string): Element {
    document.body.innerHTML = html;
    return document.body.firstElementChild as Element;
  }

  it("allows cards, buttons and links (kept clickable via the drag threshold)", () => {
    expect(startsInNonDraggable(mount("<div class='zone-card'></div>"))).toBe(false);
    expect(startsInNonDraggable(mount("<button>Zone</button>"))).toBe(false);
    expect(startsInNonDraggable(mount("<a href='#x'>link</a>"))).toBe(false);
  });

  it("skips form fields that own their own press-drag", () => {
    expect(startsInNonDraggable(mount("<input />"))).toBe(true);
    expect(startsInNonDraggable(mount("<textarea></textarea>"))).toBe(true);
    expect(startsInNonDraggable(mount("<select><option>a</option></select>"))).toBe(true);
  });

  it("skips slider thumbs and contenteditable regions", () => {
    expect(startsInNonDraggable(mount("<div role='slider'></div>"))).toBe(true);
    expect(startsInNonDraggable(mount("<div contenteditable='true'></div>"))).toBe(true);
  });

  it("skips the maplibre map and explicit opt-outs", () => {
    const map = mount("<div class='maplibregl-map'><span>tile</span></div>");
    expect(startsInNonDraggable(map.querySelector("span"))).toBe(true);
    expect(startsInNonDraggable(mount("<div data-nova-no-drag-scroll></div>"))).toBe(true);
  });

  it("walks up from a nested target to find the skip reason", () => {
    const wrap = mount("<label><span>toggle</span><input /></label>");
    // The span sits inside a <label>, which is draggable; the input itself is not.
    expect(startsInNonDraggable(wrap.querySelector("span"))).toBe(false);
    expect(startsInNonDraggable(wrap.querySelector("input"))).toBe(true);
  });

  it("returns false for a null target", () => {
    expect(startsInNonDraggable(null)).toBe(false);
  });
});

describe("page pan gestures", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function setup(wide: boolean) {
    document.body.innerHTML = '<main class="dashboard-home"><button>Zone</button><div role="slider"></div></main>';
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: wide })));
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    renderHook(useClickDragScroll);
    return scroll;
  }

  function drag(target: Element, dx: number, dy: number) {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 400, clientY: 400 }));
    window.dispatchEvent(new MouseEvent("mousemove", { cancelable: true, clientX: 400 + dx, clientY: 400 + dy }));
    window.dispatchEvent(new MouseEvent("mouseup"));
  }

  it("pans horizontally in wide mode and suppresses the trailing button click", () => {
    const scroll = setup(true);
    const button = document.querySelector("button")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    drag(button, -180, -20);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(scroll).toHaveBeenCalledWith({ left: 180, top: 0, behavior: "instant" });
    expect(clicked).not.toHaveBeenCalled();
  });

  it("keeps portrait dragging vertical", () => {
    const scroll = setup(false);
    drag(document.querySelector("button")!, -20, -150);
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 150, behavior: "instant" });
  });

  it("preserves a click below the movement threshold and leaves the knob's drag alone", () => {
    const scroll = setup(true);
    const button = document.querySelector("button")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    drag(button, 2, 2);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    drag(document.querySelector('[role="slider"]')!, -180, 0);
    expect(clicked).toHaveBeenCalledOnce();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("maps wheel input to horizontal travel without intercepting browser zoom", () => {
    const scroll = setup(true);
    const target = document.querySelector("button")!;
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
    expect(scroll).toHaveBeenCalledWith({ left: 120, behavior: "instant" });
    scroll.mockClear();
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("allows horizontal page dragging over a vertically scrolling panel", () => {
    setup(true);
    const panel = document.querySelector("main")!;
    panel.style.overflowY = "auto";
    Object.defineProperties(panel, { scrollHeight: { value: 900 }, clientHeight: { value: 400 } });
    expect(startsInNonDraggable(panel, "x")).toBe(false);
    expect(startsInNonDraggable(panel, "y")).toBe(true);
  });

  it("scrolls a vertical panel and pans the page together in wide mode", () => {
    const scroll = setup(true);
    const panel = document.querySelector("main")!;
    panel.style.overflowY = "auto";
    Object.defineProperties(panel, { scrollHeight: { value: 900 }, clientHeight: { value: 400 } });
    panel.scrollTop = 200;
    drag(document.querySelector("button")!, -120, -80);
    expect(scroll).toHaveBeenCalledWith({ left: 120, top: 0, behavior: "instant" });
    expect(panel.scrollTop).toBe(280);
  });
});
