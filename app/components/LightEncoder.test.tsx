import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder } from "./ColorEncoder";
import { litChannel, start, tap, useDialHarness } from "./ColorEncoder.fixtures";
import { LightEncoder } from "./LightEncoder";
import { lightBand } from "./lightEncoderModel";

useDialHarness();

describe("LightEncoder", () => {
  it("orders its lights Brt, Hue, Sat and opens on brightness", () => {
    const { container } = render(<LightEncoder value={start} onChange={vi.fn()} />);
    const channels = [...container.querySelectorAll(".rotary-encoder-led")].map((led) => led.getAttribute("data-channel"));
    expect(channels).toEqual(["brightness", "hue", "saturation"]);
    expect(litChannel(container)).toBe("brightness");
    const dial = screen.getByRole("slider");
    tap(dial);
    expect(litChannel(container)).toBe("hue");
    tap(dial);
    expect(litChannel(container)).toBe("saturation");
    tap(dial);
    expect(litChannel(container)).toBe("brightness");
  });

  it("paints the whole ring one colour, with no mark and no checkerboard", () => {
    const { container } = render(<LightEncoder value={{ h: 120, s: 100, v: 50, a: 100 }} onChange={vi.fn()} />);
    const root = container.querySelector(".light-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--re-mark")).toBe("");
    expect(root.style.getPropertyValue("--re-ring-paint")).toBe("linear-gradient(rgba(0, 255, 0, 1.000), rgba(0, 255, 0, 1.000))");
    expect(container.querySelector(".rotary-encoder-checker")).toBeNull();
    expect(container.querySelector(".rotary-encoder-glow-paint")).not.toBeNull();
  });

  it("leaves the colour picker drawing as before", () => {
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const root = container.querySelector(".color-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--re-mark")).toBe("");
    expect(container.querySelector(".rotary-encoder-glow-paint")).toBeNull();
  });
});

describe("the light ring", () => {
  it("is the same solid colour wherever the brightness is", () => {
    const paints = [0, 30, 100].map((v) => lightBand({ h: 200, s: 40, v, a: 100 }).paint);
    expect(new Set(paints).size).toBe(1);
    expect(paints[0]).not.toContain("conic-gradient");
  });

  it("paints the light's colour at full value and keys the glow to brightness", () => {
    const dim = lightBand({ h: 0, s: 100, v: 40, a: 100 });
    expect(dim.paint).toContain("rgba(255, 0, 0, 1.000)");
    expect(dim.glowPaint).toContain("rgba(255, 0, 0, 0.000)");
    const bright = lightBand({ h: 0, s: 100, v: 100, a: 100 });
    expect(bright.glowPaint).toContain("rgba(255, 0, 0, 0.900)");
  });
});
