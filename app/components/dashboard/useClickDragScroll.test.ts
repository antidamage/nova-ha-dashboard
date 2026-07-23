import { afterEach, describe, expect, it } from "vitest";
import { startsInNonDraggable } from "./useClickDragScroll";

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
