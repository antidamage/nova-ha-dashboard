import { describe, expect, it } from "vitest";
import { isUsableReferenceSelection, normalizedRectangle } from "./reference-selection";

describe("vehicle reference selection", () => {
  it("normalizes a reverse drag and clamps it to the photo", () => {
    expect(normalizedRectangle({ x: 1.2, y: 0.8 }, { x: 0.25, y: -0.1 })).toEqual({
      x: 0.25,
      y: 0,
      width: 0.75,
      height: 0.8,
    });
  });

  it("rejects accidental clicks and accepts a visible region", () => {
    expect(isUsableReferenceSelection({ x: 0.1, y: 0.1, width: 0.01, height: 0.2 })).toBe(false);
    expect(isUsableReferenceSelection({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 })).toBe(true);
  });
});
