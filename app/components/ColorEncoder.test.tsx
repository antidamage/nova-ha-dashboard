import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { appliedThemeRgb, type ThemeColorValue } from "./accentColor";
import { ColorEncoder, COLOR_ENCODER_CHANNELS_WITH_ALPHA } from "./ColorEncoder";
import {
  hsvaFromThemeColor,
  hsvToRgb,
  rgbToHsv,
  themeColorFromHsva,
  type Hsva,
} from "./colorEncoderModel";
import { CENTRE, degreesFor, litChannel, start, tap, turn, useDialHarness } from "./ColorEncoder.fixtures";

useDialHarness();

describe("colorEncoderModel", () => {
  it("round-trips HSV through rgb", () => {
    for (const [h, s, v] of [[0, 100, 100], [120, 50, 80], [210, 74, 82], [300, 10, 40]]) {
      const back = rgbToHsv(hsvToRgb(h, s, v));
      expect(back.h).toBeCloseTo(h, 0);
      expect(back.s).toBeCloseTo(s, 0);
      expect(back.v).toBeCloseTo(v, 0);
    }
  });

  it("reads an existing theme colour as exactly the colour it renders", () => {
    const stored: ThemeColorValue = { cursor: { x: 0.1, y: 0.9 }, intensity: 60, rgb: [80, 130, 255] };
    const hsva = hsvaFromThemeColor(stored);
    const rendered = appliedThemeRgb(stored);
    hsvToRgb(hsva.h, hsva.s, hsva.v).forEach((component, index) => {
      expect(Math.abs(component - rendered[index])).toBeLessThanOrEqual(1);
    });
  });

  it("writes rgb at full value with brightness as intensity, keeping sibling fields", () => {
    const base = { cursor: { x: 0, y: 0 }, intensity: 100, rgb: [0, 0, 0], extra: "kept" } as ThemeColorValue & { extra: string };
    const written = themeColorFromHsva({ h: 120, s: 50, v: 40, a: 100 }, base) as typeof base;
    expect(written.rgb).toEqual([128, 255, 128]);
    expect(written.intensity).toBe(40);
    expect(written.extra).toBe("kept");
    // What consumers render is the dial's colour.
    const rendered = appliedThemeRgb(written);
    hsvToRgb(120, 50, 40).forEach((component, index) => {
      expect(Math.abs(component - rendered[index])).toBeLessThanOrEqual(1);
    });
  });
});

describe("ColorEncoder", () => {

  it("cycles hue, brightness, saturation on tap, with exactly one light lit", () => {
    const { container } = render(<ColorEncoder label="Colour" value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    expect(container.querySelectorAll(".rotary-encoder-led")).toHaveLength(3);
    expect(litChannel(container)).toBe("hue");
    tap(dial);
    expect(litChannel(container)).toBe("brightness");
    tap(dial);
    expect(litChannel(container)).toBe("saturation");
    tap(dial);
    expect(litChannel(container)).toBe("hue");
  });

  it("adds the alpha light only when asked", () => {
    const { container } = render(
      <ColorEncoder channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} value={start} onChange={vi.fn()} />,
    );
    expect(container.querySelectorAll(".rotary-encoder-led")).toHaveLength(4);
  });

  it("turns clockwise up and anticlockwise down, from wherever it was grabbed", () => {
    const onChange = vi.fn();
    render(<ColorEncoder activeChannel="brightness" value={start} onChange={onChange} />);
    const dial = screen.getByRole("slider");

    turn(dial, degreesFor(10));
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(60, 5);
    turn(dial, -degreesFor(10));
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(40, 5);
    // Grabbed at 4 o'clock instead of 12: the same sweep, the same move. The
    // knob never jumps to meet the hand.
    turn(dial, degreesFor(10), {}, 120);
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(60, 5);
  });

  it("wraps hue forever and stops brightness at its ends", () => {
    const onHue = vi.fn();
    const { unmount } = render(<ColorEncoder value={{ ...start, h: 350 }} onChange={onHue} />);
    turn(screen.getByRole("slider"), 30);
    expect(onHue.mock.lastCall?.[0].h).toBeCloseTo(20, 5);
    unmount();

    const onLevel = vi.fn();
    render(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 95 }} onChange={onLevel} />);
    turn(screen.getByRole("slider"), degreesFor(40));
    expect(onLevel.mock.lastCall?.[0].v).toBe(100);
  });

  it("ignores samples in the dead centre", () => {
    const onChange = vi.fn();
    render(<ColorEncoder activeChannel="brightness" value={start} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    // A press and a sweep a couple of pixels from the middle: the angle there
    // is noise, so nothing moves.
    fireEvent.pointerDown(dial, { buttons: 1, clientX: CENTRE + 1, clientY: CENTRE, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: CENTRE, clientY: CENTRE + 1, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: CENTRE - 1, clientY: CENTRE, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(dial, { clientX: CENTRE - 1, clientY: CENTRE, pointerId: 1 });
  });

  it("is eight times finer with Shift held", () => {
    const coarse = vi.fn();
    const { unmount } = render(<ColorEncoder value={start} onChange={coarse} />);
    turn(screen.getByRole("slider"), 80);
    unmount();

    const fine = vi.fn();
    render(<ColorEncoder value={start} onChange={fine} />);
    turn(screen.getByRole("slider"), 80, { shiftKey: true });

    const coarseDelta = coarse.mock.lastCall?.[0].h - start.h;
    const fineDelta = fine.mock.lastCall?.[0].h - start.h;
    expect(coarseDelta / fineDelta).toBeCloseTo(8, 5);
  });

  it("keeps accumulating fine steps through a parent that stores rounded values", () => {
    // Config stores integer intensity; a fine drag must still move.
    function RoundingParent({ onValue }: { onValue: (value: Hsva) => void }) {
      const [value, setValue] = useState<Hsva>(start);
      return (
        <ColorEncoder
          activeChannel="brightness"
          value={value}
          onChange={(next) => {
            const rounded = { ...next, v: Math.round(next.v) };
            setValue(rounded);
            onValue(rounded);
          }}
        />
      );
    }
    const onValue = vi.fn();
    render(<RoundingParent onValue={onValue} />);
    // 43.2° of fine turn is 2%: 43.2 × (100/270) ÷ 8.
    turn(screen.getByRole("slider"), 43.2, { shiftKey: true });
    expect(onValue.mock.lastCall?.[0].v).toBe(52);
  });
});
