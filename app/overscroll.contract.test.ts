import { describe, expect, it } from "vitest";
import { readCss } from "./styles/readCss";

// globals.css is an entry file of ordered @imports now; readCss resolves them.
const globalsCss = readCss();

describe("page overscroll", () => {
  it("refuses overscroll on the root scroller, so iOS cannot bounce or reload the page", () => {
    // The declaration has to be on the html/body block in base/reset.css: an
    // inner scroller cannot stop the viewport itself from rubber-banding.
    // specs/ios-overscroll.md.
    expect(globalsCss).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/);
  });
});
