import { readFileSync } from "fs";
import { resolve } from "path";
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

/** A parent that stores what the dial sends, as every real caller does. */
function Controlled({ initial, ...props }: { initial: Hsva } & Omit<React.ComponentProps<typeof ColorEncoder>, "value" | "onChange">) {
  const [value, setValue] = useState<Hsva>(initial);
  return <ColorEncoder {...props} value={value} onChange={setValue} />;
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

  it("clicks on press and on release of a drag, never while turning", () => {
    const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
    const now = vi.spyOn(performance, "now");
    let clock = 1000;
    now.mockImplementation(() => clock);

    render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    // A long turn, fast and then slow: no clicks at any rate.
    for (let step = 1; step <= 40; step += 1) {
      clock += step <= 20 ? 16 : 600;
      fireEvent.pointerMove(dial, { buttons: 1, clientX: step * 20, clientY: 0, pointerId: 1 });
    }
    expect(click).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(dial, { clientX: 800, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(2);
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

  it("releases silently when the drag changed nothing", () => {
    const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);

    function Dial() {
      const [value, setValue] = useState<Hsva>({ ...start, v: 100 });
      return <ColorEncoder activeChannel="brightness" value={value} onChange={setValue} />;
    }
    render(<Dial />);
    const dial = screen.getByRole("slider");

    // Brightness is at its top; pushing further moves nothing.
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: 90, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(dial, { clientX: 90, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    // Out and back to where it started: still one click, the press.
    click.mockClear();
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: -30, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(dial, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    click.mockRestore();
  });

  it("scopes the light-mode well rule to unlit lights", () => {
    // Unscoped, it is the more specific selector and overrides the lit light's
    // own fill, leaving no light lit at all in light mode (2026-09-11). jsdom
    // loads no CSS, so this guards the stylesheet itself.
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('.color-encoder[data-mode="light"] .color-encoder-led[data-lit="false"] {');
    expect(css).not.toContain('.color-encoder[data-mode="light"] .color-encoder-led {');
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

  const angleOf = (container: HTMLElement) =>
    (container.querySelector(".color-encoder") as HTMLElement).style.getPropertyValue("--ce-angle");

  it("points the index at the value: 0 at 7:30, 50 at 12, 100 at 4:30, over the top", () => {
    for (const [v, expected] of [[0, "-135.00deg"], [50, "0.00deg"], [100, "135.00deg"], [20, "-81.00deg"]] as const) {
      const { container, unmount } = render(
        <ColorEncoder activeChannel="brightness" value={{ ...start, v }} onChange={vi.fn()} />,
      );
      expect(angleOf(container)).toBe(expected);
      unmount();
    }
  });

  it("points at hue as degrees", () => {
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} />);
    expect(angleOf(container)).toBe("200.00deg");
  });

  it("re-points the index on a channel change, the short way round", () => {
    // Hue 200 (south-south-west), brightness 50 (12 o'clock), saturation 100 (4:30).
    const { container } = render(<ColorEncoder value={{ h: 200, s: 100, v: 50, a: 100 }} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    expect(angleOf(container)).toBe("200.00deg");
    tap(dial);
    // 0° is 160° from 200° going clockwise, 200° going back: clockwise to 360.
    expect(angleOf(container)).toBe("360.00deg");
    tap(dial);
    expect(angleOf(container)).toBe("495.00deg");
    tap(dial);
    // Back on hue: 200° is nearest 495° at 560°.
    expect(angleOf(container)).toBe("560.00deg");
  });

  it("tracks the drag 1:1 and sweeps over the top on a big outside change", () => {
    const { container, rerender } = render(
      <ColorEncoder activeChannel="brightness" value={{ ...start, v: 0 }} onChange={vi.fn()} />,
    );
    expect(angleOf(container)).toBe("-135.00deg");
    // 0 → 100 from outside must go through 12 o'clock, not under the bottom.
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 100 }} onChange={vi.fn()} />);
    expect(angleOf(container)).toBe("135.00deg");
  });

  it("stops the index when a clamped channel hits its end, and moves again on reversal", () => {
    const { container } = render(<Controlled activeChannel="saturation" initial={{ ...start, s: 95 }} />);
    const dial = screen.getByRole("slider");
    drag(dial, [[300, 0]]);
    expect(dial.getAttribute("aria-valuenow")).toBe("100");
    expect(angleOf(container)).toBe("135.00deg");
    // Pushing further past the end turns nothing.
    drag(dial, [[200, 0]]);
    expect(angleOf(container)).toBe("135.00deg");
    // Reversing moves value and index at once — no wind-back through the overshoot.
    drag(dial, [[-30, 0]]);
    expect(dial.getAttribute("aria-valuenow")).toBe("90");
    expect(angleOf(container)).toBe("108.00deg");
  });

  it("stops at zero too, for brightness and alpha", () => {
    for (const channel of ["brightness", "alpha"] as const) {
      const { container, unmount } = render(
        <Controlled channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} activeChannel={channel} initial={{ ...start, v: 3, a: 3 }} />,
      );
      drag(screen.getByRole("slider"), [[-300, 0]]);
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("0");
      expect(angleOf(container)).toBe("-135.00deg");
      unmount();
    }
  });

  it("turns forever on hue, continuous across 360", () => {
    const { container } = render(<Controlled initial={start} />);
    drag(screen.getByRole("slider"), [[1000, 0]]);
    // +500° of hue from 200°: the index has gone round, not snapped back to 340°.
    expect(angleOf(container)).toBe("700.00deg");
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("340");
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
