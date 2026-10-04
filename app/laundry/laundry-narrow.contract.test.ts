import { describe, expect, it } from "vitest";
import { readCss } from "../styles/readCss";

// Contract tripwire for the bill's narrow layout (specs/power-meters.md §5.3).
//
// A table row cannot wrap its cells, so at 640px and below a row is a wrapping
// flex line of whole fields: each field is as wide as its own value prints, and
// carries that width on its own class (`is-date` … `is-cost`) rather than at an
// index that moves when a column arrives. The header wears the same classes, so a
// figure still sits under its own label. The page is read on somebody else's
// phone, and a layout rule nothing asserts is a layout rule the next edit can
// quietly undo — the layout this file replaced squeezed six columns into a phone
// and broke values mid-word. These read the shipped stylesheet, because that is
// what the browser gets.

/** The rows of the bill with the widths they were given, and their header. */
function fields() {
  return ["date", "start", "length", "temp", "energy", "cost"];
}

function narrowBlock() {
  // Anchored on the laundry page's own first rule in the bundle: other partials
  // carry a 640px breakpoint too, so the media query alone is not this page's.
  const css = readCss();
  const narrow = css.slice(css.indexOf("@media screen and (max-width: 640px) {\n  .laundry-page {"));

  return narrow.slice(0, narrow.indexOf("\n}\n") + 2);
}

describe("the bill's narrow layout", () => {
  it("keeps every column on a phone, wrapping the row rather than dropping one", () => {
    // Adeline, 2026-09-27: "Always show every column even if collapsed, they can
    // just wrap." The narrow layout used to drop Start and Length and hide the
    // header row; nothing on it may hide a column again. Adeline, 2026-10-05:
    // "don't remove any columns, just make it so that fields inside a row can
    // wrap" — a table row cannot wrap its cells, so a phone lays a row out as a
    // wrapping flex line of whole fields, each as wide as its own value prints.
    const block = narrowBlock();

    // Screen only: paper is the print sheet's, and a page printed at a small
    // paper size would otherwise take the wrapped row instead of the ruled table.
    expect(block).toContain("@media screen and (max-width: 640px)");
    expect(block).toContain("flex-wrap: wrap");

    // An empty month is left as the desktop row has it: the wrapping row's
    // rule does not reach it (laundry.css `.laundry-row.is-empty`).
    expect(block).toContain(".laundry-table tr.laundry-row.is-empty {");
    expect(block).toContain("border-bottom: none;");
    expect(block, "the narrow table hides something").not.toContain("display: none");
    expect(block, "a column is dropped by index again").not.toMatch(/\.laundry-table td:nth-child/);
    expect(block, "the header row is hidden again").not.toMatch(/thead[^{]*\{[^}]*display:\s*none/);
    expect(block, "the header does not wrap with its rows").toContain(".laundry-table thead tr");
    expect(block, "a field is squeezed through its own value").toContain("min-width: min-content");
  });

  it("gives each field the width its own value prints at", () => {
    const block = narrowBlock();

    for (const field of fields()) {
      expect(block, `.is-${field} has no width of its own`).toContain(`.laundry-table .is-${field} {`);
    }
    // The claim field is the widest thing in a row and cannot be narrower, so it
    // takes the line under the figures — where the header's label wraps with it.
    expect(block).toContain(".laundry-table td:last-child {");
    expect(block).toContain("flex-basis: 100%");
  });
});
