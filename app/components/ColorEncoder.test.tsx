import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as haptics from "./haptics";
import { appliedThemeRgb, type ThemeColorValue } from "./accentColor";
import { ColorEncoder, COLOR_ENCODER_CHANNELS_WITH_ALPHA } from "./ColorEncoder";
import {
  hsvaFromThemeColor,
  hsvToRgb,
  rgbToHsv,
  themeColorFromHsva,
  type Hsva,
} from "./colorEncoderModel";

beforeAll(() => {
  // jsdom does not implement pointer capture; the dial calls it on press.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
  }
});

afterEach(() => {
  cleanup();
});

function drag(dial: HTMLElement, moves: Array<[number, number]>, modifiers: { shiftKey?: boolean } = {}) {
  let x = 100;
  let y = 100;
  fireEvent.pointerDown(dial, { buttons: 1, clientX: x, clientY: y, pointerId: 1 });
  for (const [dx, dy] of moves) {
    x += dx;
    y += dy;
    fireEvent.pointerMove(dial, { buttons: 1, clientX: x, clientY: y, pointerId: 1, ...modifiers });
  }
  fireEvent.pointerUp(dial, { clientX: x, clientY: y, pointerId: 1 });
}

function tap(dial: HTMLElement) {
  fireEvent.pointerDown(dial, { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(dial, { clientX: 51, clientY: 50, pointerId: 1 });
}

function litChannel(container: HTMLElement) {
  const lit = container.querySelectorAll('.color-encoder-led[data-lit="true"]');
  expect(lit).toHaveLength(1);
  return (lit[0] as HTMLElement).dataset.channel;
}

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
  const start: Hsva = { h: 200, s: 50, v: 50, a: 100 };

  it("cycles hue, brightness, saturation on tap, with exactly one light lit", () => {
    const { container } = render(<ColorEncoder label="Colour" value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    expect(container.querySelectorAll(".color-encoder-led")).toHaveLength(3);
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
    expect(container.querySelectorAll(".color-encoder-led")).toHaveLength(4);
  });

  it("turns up for right and up, down for left and down", () => {
    const onChange = vi.fn();
    render(<ColorEncoder activeChannel="brightness" value={start} onChange={onChange} />);
    const dial = screen.getByRole("slider");

    drag(dial, [[30, 0]]);
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(60, 5);
    drag(dial, [[0, -30]]);
    expect(onChange.mock.lastCall?.[0].v).toBeGreaterThan(50);
    drag(dial, [[-30, 0]]);
    expect(onChange.mock.lastCall?.[0].v).toBeLessThan(60.001);
  });

  it("wraps hue forever and stops brightness at its ends", () => {
    const onHue = vi.fn();
    const { unmount } = render(<ColorEncoder value={{ ...start, h: 350 }} onChange={onHue} />);
    drag(screen.getByRole("slider"), [[60, 0]]);
    expect(onHue.mock.lastCall?.[0].h).toBeCloseTo(20, 5);
    unmount();

    const onLevel = vi.fn();
    render(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 95 }} onChange={onLevel} />);
    drag(screen.getByRole("slider"), [[300, 0]]);
    expect(onLevel.mock.lastCall?.[0].v).toBe(100);
  });

  it("is eight times finer with Shift held", () => {
    const coarse = vi.fn();
    const { unmount } = render(<ColorEncoder value={start} onChange={coarse} />);
    drag(screen.getByRole("slider"), [[80, 0]]);
    unmount();

    const fine = vi.fn();
    render(<ColorEncoder value={start} onChange={fine} />);
    drag(screen.getByRole("slider"), [[80, 0]], { shiftKey: true });

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
    drag(screen.getByRole("slider"), Array.from({ length: 48 }, () => [1, 0] as [number, number]), { shiftKey: true });
    // 48px × (1/3 ÷ 8) %/px = 2%.
    expect(onValue.mock.lastCall?.[0].v).toBe(52);
  });

  it("clicks on press, then at most once per 400ms of turning", () => {
    const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
    const now = vi.spyOn(performance, "now");
    let clock = 1000;
    now.mockImplementation(() => clock);

    render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    // A fast spin inside the floor: plenty of travel, but no further clicks.
    for (let step = 1; step <= 10; step += 1) {
      clock += 16;
      fireEvent.pointerMove(dial, { buttons: 1, clientX: step * 20, clientY: 0, pointerId: 1 });
    }
    expect(click).toHaveBeenCalledTimes(1);

    // Past the floor, with travel behind it, one more click.
    clock += 400;
    fireEvent.pointerMove(dial, { buttons: 1, clientX: 400, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(2);

    fireEvent.pointerUp(dial, { clientX: 400, clientY: 0, pointerId: 1 });
    now.mockRestore();
    click.mockRestore();
  });

  it("clicks once for a quick tap, twice for a deliberate press", () => {
    const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
    const now = vi.spyOn(performance, "now");
    let clock = 5000;
    now.mockImplementation(() => clock);

    render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");

    // Tap: down and straight back up. One click, on the way down.
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    clock += 90;
    fireEvent.pointerUp(dial, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    // Press and hold, then release without moving: two gestures, two clicks.
    click.mockClear();
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    clock += 900;
    fireEvent.pointerUp(dial, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(2);

    now.mockRestore();
    click.mockRestore();
  });

  it("ignores an incoming value while the drag is still in the hand", () => {
    // A zone reporting a waypoint of a fade must not yank a turn in progress.
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorEncoder activeChannel="brightness" value={{ ...start, v: 90 }} onChange={onChange} />,
    );
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: 30, clientY: 0, pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(100, 5);

    // Mid-drag echo of a much lower brightness: ignored.
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 12 }} onChange={onChange} />);
    fireEvent.pointerMove(dial, { buttons: 1, clientX: 60, clientY: 0, pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBe(100);
    expect(dial.getAttribute("aria-valuenow")).toBe("100");

    // Once the gesture is over, a genuine outside change is taken.
    fireEvent.pointerUp(dial, { clientX: 60, clientY: 0, pointerId: 1 });
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 12 }} onChange={onChange} />);
    expect(dial.getAttribute("aria-valuenow")).toBe("12");
  });

  it("commits once per gesture, and a tap commits nothing", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<ColorEncoder value={start} onChange={onChange} onCommit={onCommit} />);
    const dial = screen.getByRole("slider");
    tap(dial);
    expect(onCommit).not.toHaveBeenCalled();
    drag(dial, [[10, 0], [10, 0], [10, 0]]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("rotates the rotor while dragging", () => {
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const root = container.querySelector(".color-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--ce-angle")).toBe("0.00deg");
    drag(screen.getByRole("slider"), [[40, 0]]);
    expect(root.style.getPropertyValue("--ce-angle")).toBe("20.00deg");
  });

  it("glows only from half brightness up", () => {
    const { container, rerender } = render(<ColorEncoder value={{ ...start, v: 49 }} onChange={vi.fn()} />);
    const root = container.querySelector(".color-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--ce-glow")).toBe("0 0 0 rgba(0, 0, 0, 0)");
    rerender(<ColorEncoder value={{ ...start, v: 100 }} onChange={vi.fn()} />);
    expect(root.style.getPropertyValue("--ce-glow")).toMatch(/px rgba\(/);
  });

  it("clamps size to 50–200px", () => {
    const { container, rerender } = render(<ColorEncoder size={20} value={start} onChange={vi.fn()} />);
    const root = () => container.querySelector(".color-encoder") as HTMLElement;
    expect(root().style.getPropertyValue("--ce-size")).toBe("50px");
    rerender(<ColorEncoder size={500} value={start} onChange={vi.fn()} />);
    expect(root().style.getPropertyValue("--ce-size")).toBe("200px");
  });

  it("submits hex, rgb, or rgba with opacity", () => {
    const { container, rerender } = render(
      <ColorEncoder name="colour" value={{ h: 0, s: 100, v: 100, a: 100 }} onChange={vi.fn()} />,
    );
    const input = () => container.querySelector('input[name="colour"]') as HTMLInputElement;
    expect(input().value).toBe("#ff0000");
    rerender(<ColorEncoder name="colour" format="rgb" value={{ h: 0, s: 100, v: 100, a: 100 }} onChange={vi.fn()} />);
    expect(input().value).toBe("rgb(255, 0, 0)");
    rerender(
      <ColorEncoder
        name="colour"
        channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA}
        value={{ h: 0, s: 100, v: 100, a: 40 }}
        onChange={vi.fn()}
      />,
    );
    expect(input().value).toBe("rgba(255, 0, 0, 0.400)");
  });

  it("names the active channel but writes no value anywhere", () => {
    const { container } = render(<ColorEncoder label="Accent" value={start} onChange={vi.fn()} />);
    // The label and the channel caption are the only text: no hex, no numbers.
    expect(container.textContent).toBe("AccentHUE");
    expect(container.textContent).not.toMatch(/\d/);
    const dial = screen.getByRole("slider");
    tap(dial);
    expect(container.textContent).toBe("AccentBRIGHT");
    tap(dial);
    expect(container.textContent).toBe("AccentSAT");
  });

  it("captions the alpha channel, and abbreviates at the smaller size", () => {
    const { container, rerender } = render(
      <ColorEncoder channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} activeChannel="alpha" value={start} onChange={vi.fn()} />,
    );
    expect(container.textContent).toBe("ALPHA");

    // At 100px the caption font is pinned at its 10px floor, so it shortens.
    rerender(
      <ColorEncoder size={100} channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} activeChannel="alpha" value={start} onChange={vi.fn()} />,
    );
    expect(container.textContent).toBe("ALPH");
    rerender(<ColorEncoder size={100} activeChannel="brightness" value={start} onChange={vi.fn()} />);
    expect(container.textContent).toBe("BRT");
    rerender(<ColorEncoder size={200} activeChannel="brightness" value={start} onChange={vi.fn()} />);
    expect(container.textContent).toBe("BRIGHT");
  });

  it("drives from the keyboard", () => {
    const onChange = vi.fn();
    const { container } = render(<ColorEncoder value={start} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.keyDown(dial, { key: "ArrowRight" });
    expect(onChange.mock.lastCall?.[0].h).toBeCloseTo(204, 5);
    fireEvent.keyDown(dial, { key: "Enter" });
    expect(litChannel(container)).toBe("brightness");
  });
});
