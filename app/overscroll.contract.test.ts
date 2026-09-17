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

// Just the root rules that say something about overscroll. A later
// `html, body { font-size: 100% }` is not this test's business.
const overscrollBlocks = rootBlocks.filter((block) => block.includes("overscroll"));

describe("page overscroll", () => {
  it("refuses overscroll on the root scroller, so iOS cannot bounce or reload the page", () => {
    expect(overscrollBlocks.length).toBeGreaterThan(0);
    // The last one wins: the stylesheet has no @layer discipline, so source
    // order decides, and an inner scroller cannot suppress the viewport's own
    // overscroll.
    expect(overscrollBlocks.at(-1)).toMatch(/overscroll-behavior:\s*none\s*;/);
  });

  it("leaves no root rule that hands overscroll back to the browser", () => {
    // Every overscroll declaration on the root has to be the shorthand's
    // `none`: a longhand after it, such as `overscroll-behavior-x: auto`,
    // would hand that axis back.
    const handedBack = overscrollBlocks.filter((block) =>
      block.replace(/overscroll-behavior(?:-[xy])?:\s*none\s*;?/g, "").includes("overscroll"),
    );
    expect(handedBack).toEqual([]);
  });
});
