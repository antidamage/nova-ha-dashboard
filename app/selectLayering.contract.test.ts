import { describe, expect, it } from "vitest";
import { readCss } from "./styles/readCss";

// globals.css is an entry file of ordered @imports now; readCss resolves them.
const globalsCss = readCss();

function zIndexFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = globalsCss.match(new RegExp(`${escaped}[^\\{]*\\{([^}]+)\\}`))?.[1] ?? "";
  return Number(block.match(/z-index:\s*(\d+)/)?.[1] ?? 0);
}

describe("custom selector layering", () => {
  it("keeps portalled dropdown options interactive above modal overlays", () => {
    expect(zIndexFor(".cyber-select-menu-portal")).toBeGreaterThan(zIndexFor(".modal-overlay,"));
  });

  it("keeps the slider numeric-entry field above modal overlays", () => {
    // Sliders appear inside ColorWidget's modal, and a popover under the
    // overlay is one the modal intercepts every tap for.
    expect(zIndexFor(".cyber-numeric-entry")).toBeGreaterThan(zIndexFor(".modal-overlay,"));
  });
});
