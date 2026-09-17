import { describe, expect, it } from "vitest";
import { readCss } from "./styles/readCss";

// globals.css is an entry file of ordered @imports now; readCss resolves them.
// Comments go first: a declaration that has been commented out is not a
// declaration, and would otherwise satisfy the match below.
const globalsCss = readCss().replace(/\/\*[\s\S]*?\*\//g, "");

// Every `html, body` rule in the bundle, in document order, as its declaration
// text. This test reads the stylesheet as literal text, so it pins one
// spelling: the shorthand, in that exact block, in base/reset.css. Splitting
// the block in two, switching to the longhands, or renaming the file all mean
// updating this test, deliberately. specs/ios-overscroll.md.
const rootBlocks = [...globalsCss.matchAll(/html,\s*body\s*\{([^}]*)\}/g)].map(
  (match) => match[1],
);

describe("page overscroll", () => {
  it("refuses overscroll on the root scroller, so iOS cannot bounce or reload the page", () => {
    expect(rootBlocks.length).toBeGreaterThan(0);
    // The last one wins: the stylesheet has no @layer discipline, so source
    // order decides, and an inner scroller cannot suppress the viewport's own
    // overscroll.
    expect(rootBlocks.at(-1)).toMatch(/overscroll-behavior:\s*none/);
  });

  it("leaves no root rule that hands overscroll back to the browser", () => {
    const handedBack = rootBlocks.filter(
      (block) => block.includes("overscroll") && !/overscroll-behavior:\s*none/.test(block),
    );
    expect(handedBack).toEqual([]);
  });
});
