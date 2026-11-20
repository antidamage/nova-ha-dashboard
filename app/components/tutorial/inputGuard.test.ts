// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isMaskTap, shouldBlock, STRICT_EVENTS } from "./inputGuard";

function mount(html: string) {
  document.body.innerHTML = html;
}

const event = (type: string, selector: string, isTrusted = true) => ({
  type,
  isTrusted,
  target: document.querySelector(selector),
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tutorial input guard", () => {
  it("never touches scrolling", () => {
    expect(STRICT_EVENTS).not.toContain("wheel");
    expect(STRICT_EVENTS).not.toContain("touchmove");
    expect(STRICT_EVENTS).not.toContain("scroll");
  });

  it("lets the finger's synthetic events through", () => {
    mount(`<div class="rotary-encoder"><div class="rotary-encoder-dial"></div></div>`);
    expect(shouldBlock(event("pointerdown", ".rotary-encoder-dial", false), "strict")).toBe(false);
  });

  it("lets the tour's own elements and the copy's rings through", () => {
    mount(`<section data-tutorial-ui><button id="next">Next</button></section>
      <div class="rotary-encoder-ring-layer" data-portal-tag="tutorial"><svg><path id="thumb"/></svg></div>`);
    expect(shouldBlock(event("click", "#next"), "strict")).toBe(false);
    expect(shouldBlock(event("pointerdown", "#thumb"), "strict")).toBe(false);
  });

  describe("strict (live dashboard)", () => {
    it("stops every press outside the tour, a dial div the same as a button", () => {
      mount(`<div class="card"><div class="rotary-encoder"><div class="rotary-encoder-dial"></div></div><button id="b">Off</button><p id="blank">x</p></div>`);
      for (const type of STRICT_EVENTS) {
        expect(shouldBlock(event(type, ".rotary-encoder-dial"), "strict"), type).toBe(true);
        expect(shouldBlock(event(type, "#b"), "strict"), type).toBe(true);
        expect(shouldBlock(event(type, "#blank"), "strict"), type).toBe(true);
      }
    });
  });

  describe("scroll-friendly (demo)", () => {
    it("lets a press on blank card space through, for mouse drag-scroll", () => {
      mount(`<div class="card"><p id="blank">x</p></div>`);
      expect(shouldBlock(event("pointerdown", "#blank"), "scroll-friendly")).toBe(false);
      expect(shouldBlock(event("mousedown", "#blank"), "scroll-friendly")).toBe(false);
      expect(shouldBlock(event("click", "#blank"), "scroll-friendly")).toBe(true);
    });

    it("stops a press that lands on a control", () => {
      mount(`<div class="rotary-encoder"><div class="rotary-encoder-dial"><span id="led"></span></div></div><div class="nova-avatar-host"><canvas id="orb"></canvas></div>`);
      expect(shouldBlock(event("pointerdown", "#led"), "scroll-friendly")).toBe(true);
      expect(shouldBlock(event("touchstart", "#orb"), "scroll-friendly")).toBe(true);
    });
  });

  it("calls a click outside the tour a tap on the mask", () => {
    mount(`<p id="blank">x</p><section data-tutorial-ui><button id="next">Next</button></section>`);
    expect(isMaskTap(event("click", "#blank"))).toBe(true);
    expect(isMaskTap(event("click", "#next"))).toBe(false);
    expect(isMaskTap(event("click", "#blank", false))).toBe(false);
  });
});
