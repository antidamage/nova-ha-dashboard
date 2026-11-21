import { describe, expect, it } from "vitest";
import { fitStack, LIFT, SELECT_LIFT, TILT_DEG } from "./layerFit";

/** The stack's worst-case on-screen box, turned any way. */
function extent(frame: { width: number; height: number }, cards: number, body: { width: number; height: number }) {
  const fit = fitStack(frame, cards, body);
  const diagonal = Math.hypot(fit.card.width, fit.card.height);
  const tilt = (TILT_DEG * Math.PI) / 180;
  const lifts = ((cards - 1) * LIFT + SELECT_LIFT) * fit.card.height;
  return { width: diagonal, height: diagonal * Math.cos(tilt) + lifts * Math.sin(tilt) };
}

describe("fitStack", () => {
  const cases = [
    { name: "phone portrait, 12 knob layers", frame: { width: 260, height: 260 }, cards: 12, body: { width: 358, height: 330 } },
    { name: "tablet landscape, 9 background layers", frame: { width: 1366, height: 1024 }, cards: 9, body: { width: 950, height: 900 } },
    { name: "kiosk portrait, 6 orb layers", frame: { width: 200, height: 200 }, cards: 6, body: { width: 1040, height: 1100 } },
    { name: "tiny body", frame: { width: 300, height: 200 }, cards: 12, body: { width: 120, height: 90 } },
  ];
  for (const { name, frame, cards, body } of cases) {
    it(`always fits inside the stage: ${name}`, () => {
      const box = extent(frame, cards, body);
      expect(box.width).toBeLessThanOrEqual(body.width);
      expect(box.height).toBeLessThanOrEqual(body.height);
    });
  }

  it("keeps the frame's shape", () => {
    const fit = fitStack({ width: 400, height: 200 }, 6, { width: 800, height: 800 });
    expect(fit.card.width / fit.card.height).toBeCloseTo(2);
  });

  it("never returns a negative or infinite size", () => {
    const fit = fitStack({ width: 0, height: 0 }, 0, { width: 0, height: 0 });
    expect(Number.isFinite(fit.card.width)).toBe(true);
    expect(fit.card.width).toBeGreaterThanOrEqual(0);
  });
});
