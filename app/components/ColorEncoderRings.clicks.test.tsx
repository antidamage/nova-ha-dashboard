import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import * as haptics from "./haptics";
import { ColorEncoder } from "./ColorEncoder";
import { ringGeometry } from "./rotaryEncoderGeometry";
import { Controlled, at, onKnob, start, svgOf, useDialHarness } from "./ColorEncoderRings.fixtures";

useDialHarness();

describe("ColorEncoder", () => {
  describe("clicks", () => {
    function clock() {
      let time = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => time);
      return (ms: number) => { time += ms; };
    }

    it("dial: press, silence while turning, release only if it changed", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      function Dial() {
        const [value, setValue] = useState(start);
        return <ColorEncoder label="Lights" defaultChannel="brightness" value={value} onChange={setValue} />;
      }
      render(<Dial />);
      const dial = screen.getByRole("slider", { name: "Lights" });

      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);
      for (let step = 1; step <= 30; step += 1) {
        advance(step <= 15 ? 16 : 600);
        fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(step * 8), pointerId: 1 });
      }
      expect(click).toHaveBeenCalledTimes(1);
      // 240Â° of turn takes brightness from 50 past its top, so it ends pinned.
      fireEvent.pointerUp(dial, { ...onKnob(240), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(2);

      // Brightness is now at its top; pushing further changes nothing.
      click.mockClear();
      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(60), pointerId: 1 });
      fireEvent.pointerUp(dial, { ...onKnob(60), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);

      // A drag out and back to where it started: silent release.
      click.mockClear();
      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(-20), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(60), pointerId: 1 });
      fireEvent.pointerUp(dial, { ...onKnob(60), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);
    });

    it("ring: press, silence while dragging, release only if it changed", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[50]} />);
      const radius = ringGeometry(200, 1, true).radii[0];
      const svg = svgOf(container);

      fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
      expect(click).toHaveBeenCalledTimes(1);
      for (let angle = 10; angle <= 100; angle += 10) {
        advance(500);
        fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
      }
      expect(click).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 100) });
      expect(click).toHaveBeenCalledTimes(2);

    });

    it("ring: pushing on past an end releases silently", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[100]} />);
      const radius = ringGeometry(200, 1, true).radii[0];
      const svg = svgOf(container);
      fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 134) });
      advance(500);
      fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, 170) });
      fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 170) });
      expect(click).toHaveBeenCalledTimes(1);
    });

    it("ring: a quick tap that jumps the thumb clicks once", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[10]} />);
      const radius = ringGeometry(200, 1, true).radii[0];
      fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 0) });
      advance(80);
      fireEvent.pointerUp(svgOf(container), { pointerId: 1, ...at(radius, 0) });
      expect(click).toHaveBeenCalledTimes(1);
    });
  });
});
