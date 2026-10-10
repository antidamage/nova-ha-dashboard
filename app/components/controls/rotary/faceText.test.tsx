import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FACE_DECIMAL_CLASS, FaceText, setFaceTextContent, splitDecimal } from "./faceText";

describe("splitDecimal", () => {
  it("splits a plain decimal and leaves everything else whole", () => {
    expect(splitDecimal("22.5")).toEqual(["22", ".5"]);
    expect(splitDecimal("-3.25")).toEqual(["-3", ".25"]);
    expect(splitDecimal("22")).toBeNull();
    expect(splitDecimal("--")).toBeNull();
    expect(splitDecimal("VOLUME")).toBeNull();
    expect(splitDecimal("22.5°")).toBeNull();
  });
});

describe("FaceText", () => {
  it("wraps the decimal part, keeping the text the same", () => {
    const { container } = render(<span><FaceText text="19.5" decimals /></span>);
    expect(container.textContent).toBe("19.5");
    expect(container.querySelector(`.${FACE_DECIMAL_CLASS}`)?.textContent).toBe(".5");
  });

  it("prints plain text when decimals are off or there is no decimal", () => {
    const off = render(<span><FaceText text="19.5" /></span>);
    expect(off.container.querySelector(`.${FACE_DECIMAL_CLASS}`)).toBeNull();
    const whole = render(<span><FaceText text="20" decimals /></span>);
    expect(whole.container.querySelector(`.${FACE_DECIMAL_CLASS}`)).toBeNull();
  });
});

describe("setFaceTextContent", () => {
  it("builds the same markup for the fit probe", () => {
    const node = document.createElement("span");
    setFaceTextContent(node, "19.5", true);
    expect(node.textContent).toBe("19.5");
    expect(node.querySelector(`.${FACE_DECIMAL_CLASS}`)?.textContent).toBe(".5");
    setFaceTextContent(node, "19.5", false);
    expect(node.querySelector(`.${FACE_DECIMAL_CLASS}`)).toBeNull();
  });
});
