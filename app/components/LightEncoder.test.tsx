import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder } from "./ColorEncoder";
import { litChannel, start, tap, useDialHarness } from "./ColorEncoder.fixtures";
import { LightEncoder } from "./LightEncoder";
import { lightBand, lightFillArc, lightRingMark } from "./lightEncoderModel";

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

  it("publishes the mark and paints the band from it, with no checkerboard", () => {
    const { container } = render(<LightEncoder value={{ h: 120, s: 100, v: 50, a: 100 }} onChange={vi.fn()} />);
    const root = container.querySelector(".light-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--re-mark")).toBe("135.00deg");
    expect(root.style.getPropertyValue("--re-ring-paint")).toContain("var(--re-mark)");
    expect(root.style.getPropertyValue("--re-ring-paint")).toContain("var(--re-ring-empty)");
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

describe("the light band", () => {
  it("fills from 7:30 for brightness and saturation, from 12 for hue", () => {
    expect(lightFillArc("brightness", [255, 0, 0]).startsWith("conic-gradient(from 225deg")).toBe(true);
    expect(lightFillArc("hue", [255, 0, 0]).startsWith("conic-gradient(from 0deg")).toBe(true);
  });

  it("puts the mark at the index: 2.7° per point, or the hue itself", () => {
    const colour = { h: 200, s: 40, v: 100, a: 100 };
    expect(lightRingMark("brightness", colour)).toBe(270);
    expect(lightRingMark("saturation", colour)).toBeCloseTo(108, 5);
    expect(lightRingMark("hue", colour)).toBe(200);
    expect(lightRingMark("brightness", { ...colour, v: 0 })).toBe(0);
  });

  it("is soft at both ends, and the fades shrink to nothing at zero", () => {
    const arc = lightFillArc("brightness", [10, 20, 30]);
    expect(arc).toContain("rgba(10, 20, 30, 0) 0deg");
    expect(arc).toContain("rgba(10, 20, 30, 1.000) min(24deg, var(--re-mark) * 0.5)");
    expect(arc).toContain("rgba(10, 20, 30, 1.000) calc(var(--re-mark) - min(12deg, var(--re-mark) * 0.5))");
    expect(arc).toContain("rgba(10, 20, 30, 0) calc(var(--re-mark) + min(12deg, var(--re-mark) * 0.5))");
  });

  it("paints the light's colour at full value and keys the glow to brightness", () => {
    const dim = lightBand("brightness", { h: 0, s: 100, v: 40, a: 100 });
    expect(dim.paint).toContain("rgba(255, 0, 0, 1.000)");
    expect(dim.glowPaint).toContain("rgba(255, 0, 0, 0.000)");
    const bright = lightBand("brightness", { h: 0, s: 100, v: 100, a: 100 });
    expect(bright.glowPaint).toContain("rgba(255, 0, 0, 0.900)");
  });
});
