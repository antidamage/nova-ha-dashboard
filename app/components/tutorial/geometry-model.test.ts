import { describe, expect, it } from "vitest";
import { BAR_HEIGHT, captionPlacement, cutoutFor, isOffscreen, maskPath, panelWidth, PANEL_GAP, unionBox } from "./geometry-model";

const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe("tutorial geometry", () => {
  it("pads the cut-out round the control", () => {
    expect(cutoutFor({ left: 100, top: 50, width: 200, height: 200 })).toEqual({ left: 88, top: 38, width: 224, height: 224 });
  });

  it("draws a viewport mask with a hole, or none", () => {
    expect(maskPath({ width: 100, height: 50 }, null)).toBe("M0 0H100V50H0Z");
    const path = maskPath({ width: 400, height: 400 }, { left: 10, top: 10, width: 100, height: 100 });
    expect(path.startsWith("M0 0H400V400H0Z")).toBe(true);
    expect(path).toContain("A18 18");
  });

  it("knows when a control has left the viewport", () => {
    const viewport = { width: 800, height: 600 };
    expect(isOffscreen({ left: 0, top: -300, width: 200, height: 200 }, viewport)).toBe(true);
    expect(isOffscreen({ left: 0, top: -150, width: 200, height: 200 }, viewport)).toBe(false);
    expect(isOffscreen({ left: 800, top: 0, width: 10, height: 10 }, viewport)).toBe(true);
  });

  const cases = [
    { name: "phone portrait, knob near the top", viewport: { width: 390, height: 844 }, cutout: { left: 80, top: 120, width: 230, height: 230 } },
    { name: "phone portrait, knob near the bottom", viewport: { width: 390, height: 844 }, cutout: { left: 80, top: 520, width: 230, height: 230 } },
    { name: "tablet landscape, knob on the left", viewport: { width: 1366, height: 1024 }, cutout: { left: 260, top: 300, width: 260, height: 260 } },
    { name: "tablet landscape, knob on the right", viewport: { width: 1366, height: 1024 }, cutout: { left: 1000, top: 300, width: 260, height: 260 } },
    { name: "kiosk portrait", viewport: { width: 1080, height: 1920 }, cutout: { left: 400, top: 900, width: 280, height: 280 } },
  ];
  for (const { name, viewport, cutout } of cases) {
    it(`never covers the cut-out or the bar: ${name}`, () => {
      const panel = { width: panelWidth(viewport), height: 150 };
      const placement = captionPlacement(cutout, viewport, panel);
      const box = { left: placement.left, top: placement.top, ...panel };
      expect(overlaps(box, cutout)).toBe(false);
      expect(box.top + box.height).toBeLessThanOrEqual(viewport.height - BAR_HEIGHT - PANEL_GAP + 0.5);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(viewport.width);
    });
  }

  it("prefers beside in landscape and above/below in portrait", () => {
    expect(captionPlacement({ left: 260, top: 300, width: 260, height: 260 }, { width: 1366, height: 1024 }, { width: 420, height: 150 }).side).toBe("right");
    expect(captionPlacement({ left: 80, top: 120, width: 230, height: 230 }, { width: 390, height: 844 }, { width: 358, height: 150 }).side).toBe("below");
  });

  it("docks above the bar when no side has room", () => {
    const placement = captionPlacement({ left: 0, top: 60, width: 390, height: 640 }, { width: 390, height: 844 }, { width: 358, height: 150 });
    expect(placement.side).toBe("docked");
  });

  it("holds a knob and its floating rings in one box", () => {
    expect(unionBox({ left: 100, top: 100, width: 100, height: 100 }, { left: 60, top: 70, width: 180, height: 180 }))
      .toEqual({ left: 60, top: 70, width: 180, height: 180 });
    expect(unionBox(null, { left: 1, top: 2, width: 3, height: 4 })).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("caps the panel at 420px and fits a phone", () => {
    expect(panelWidth({ width: 1920, height: 1080 })).toBe(420);
    expect(panelWidth({ width: 390, height: 844 })).toBe(358);
  });
});
