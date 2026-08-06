import { describe, expect, it } from "vitest";
import { applyPatch, diffJson, getAtPointer, invertPatch } from "./json-patch";

describe("diff and apply round trip", () => {
  const cases: [string, unknown, unknown][] = [
    ["scalar change", { a: 1 }, { a: 2 }],
    ["key added", { a: 1 }, { a: 1, b: 2 }],
    ["key removed", { a: 1, b: 2 }, { a: 1 }],
    ["nested change", { a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }],
    ["array grew", { a: [1, 2] }, { a: [1, 2, 3] }],
    ["array shrank", { a: [1, 2, 3] }, { a: [1] }],
    ["array element changed", { a: [{ id: "x" }] }, { a: [{ id: "y" }] }],
    ["array emptied", { a: [1, 2, 3] }, { a: [] }],
    ["type changed", { a: [1] }, { a: { b: 1 } }],
    ["null vs missing", { a: null }, {}],
    ["deep list of objects", { t: [{ c: { r: [1, 2, 3] } }, { c: { r: [4] } }] },
      { t: [{ c: { r: [1, 9, 3] } }] }],
    ["keys with slashes and tildes", {}, { "a/b": 1, "c~d": 2 }],
  ];

  for (const [name, before, after] of cases) {
    it(`reproduces ${name} exactly`, () => {
      expect(applyPatch(before, diffJson(before, after))).toEqual(after);
    });

    it(`inverts ${name} back to the original`, () => {
      const patch = diffJson(before, after);
      expect(applyPatch(applyPatch(before, patch), invertPatch(before, patch))).toEqual(before);
    });
  }

  it("emits nothing when the documents match", () => {
    expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });

  it("does not mutate the document it is applied to", () => {
    const before = { a: [1, 2] };
    applyPatch(before, diffJson(before, { a: [9] }));
    expect(before).toEqual({ a: [1, 2] });
  });

  it("removes several array entries without shifting the ones still to go", () => {
    // Removals emitted low-index-first delete the wrong elements, which is how
    // a restore would silently lose the wrong colour theme.
    const before = { a: ["keep", "drop1", "drop2", "drop3"] };
    expect(applyPatch(before, diffJson(before, { a: ["keep"] }))).toEqual({ a: ["keep"] });
  });

  it("reads an escaped pointer back", () => {
    expect(getAtPointer({ "a/b": { "c~d": 7 } }, "/a~1b/c~0d")).toBe(7);
  });
});
