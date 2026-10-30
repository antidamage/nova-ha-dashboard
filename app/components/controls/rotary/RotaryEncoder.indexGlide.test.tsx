import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dial, useDialHarness } from "./RotaryEncoder.fixtures";

useDialHarness();

const css = readFileSync("app/styles/controls/rotary-knob-face.css", "utf8");

describe("the index between steps", () => {
  it("marks a dial whose index glides while it is turned", () => {
    render(<Dial indexGlide />);
    expect(screen.getByRole("slider").getAttribute("data-index-glide")).toBe("true");
  });

  it("leaves every other dial tracking the hand 1:1", () => {
    render(<Dial />);
    expect(screen.getByRole("slider").hasAttribute("data-index-glide")).toBe(false);
  });

  it("only drops the sweep under the hand for a dial that does not glide", () => {
    expect(css).toContain('.rotary-encoder-dial[data-pressed="true"]:not([data-index-glide="true"]) > .rotary-encoder-rotor {');
    expect(css).toContain('.rotary-encoder:has(> .rotary-encoder-dial[data-pressed="true"]:not([data-index-glide="true"])) {');
  });
});
