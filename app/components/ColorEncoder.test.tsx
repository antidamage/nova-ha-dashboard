import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readCss } from "../styles/readCss";
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

/** The 200px dial's box: --re-outer is 1.244 knob diameters. */
const DIAL_BOX = 248.8;
const CENTRE = DIAL_BOX / 2;
/** Where the test grabs the knob: well outside the dead centre. */
const GRIP = CENTRE * 0.8;

beforeAll(() => {
  // jsdom does not implement pointer capture; the dial calls it on press.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
  }
  // It lays nothing out either, and an angular drag needs the dial's box. Only
  // the dial gets one: the knob label's fitting probe measures itself and must
  // keep reading zero, so that everything "fits" here as it did before.
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
    if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
    return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  cleanup();
});

/** A point on the knob at `angle`, clockwise degrees from 12 o'clock. */
function at(angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: CENTRE + GRIP * Math.sin(radians), clientY: CENTRE - GRIP * Math.cos(radians) };
}

/**
 * Turns the knob by `degrees`, the way a hand does: press, sweep round the
 * centre, release. Long turns are broken into steps under a half-turn, since a
 * single sample past 180° is ambiguous — as it is for a real pointer.
 */
function turn(dial: HTMLElement, degrees: number, modifiers: { shiftKey?: boolean } = {}, from = 0) {
  const steps = Math.max(1, Math.ceil(Math.abs(degrees) / 90));
  fireEvent.pointerDown(dial, { buttons: 1, ...at(from), pointerId: 1 });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.pointerMove(dial, { buttons: 1, ...at(from + (degrees * step) / steps), pointerId: 1, ...modifiers });
  }
  fireEvent.pointerUp(dial, { ...at(from + degrees), pointerId: 1 });
}

/** Degrees of turn that move a 0–100 channel by `percent`. */
function degreesFor(percent: number) {
  return percent * 2.7;
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
  const lit = container.querySelectorAll('.rotary-encoder-led[data-lit="true"]');
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

  it("clicks on press and on release of a drag, never while turning", () => {
    const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
    const now = vi.spyOn(performance, "now");
    let clock = 1000;
    now.mockImplementation(() => clock);

    render(<ColorEncoder value={start} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, ...at(0), pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    // A long turn, fast and then slow: no clicks at any rate.
    for (let step = 1; step <= 40; step += 1) {
      clock += step <= 20 ? 16 : 600;
      fireEvent.pointerMove(dial, { buttons: 1, ...at(step * 8), pointerId: 1 });
    }
    expect(click).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(dial, { ...at(320), pointerId: 1 });
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

    // Brightness is at its top; turning further moves nothing.
    turn(dial, 40);
    expect(click).toHaveBeenCalledTimes(1);

    // Down off the stop and back onto it: it ends where it started, so the
    // release is silent — only the press clicked.
    click.mockClear();
    fireEvent.pointerDown(dial, { buttons: 1, ...at(0), pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, ...at(-20), pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, ...at(40), pointerId: 1 });
    fireEvent.pointerUp(dial, { ...at(40), pointerId: 1 });
    expect(click).toHaveBeenCalledTimes(1);

    click.mockRestore();
  });

  it("scopes the light-mode well rule to unlit lights", () => {
    // Unscoped, it is the more specific selector and overrides the lit light's
    // own fill, leaving no light lit at all in light mode (2026-09-11). jsdom
    // loads no CSS, so this guards the stylesheet itself.
    const css = readCss();
    expect(css).toContain('.rotary-encoder[data-mode="light"] .rotary-encoder-led[data-lit="false"] {');
    expect(css).not.toContain('.rotary-encoder[data-mode="light"] .rotary-encoder-led {');
  });

  it("paints the lit light and its glow from the theme's LED colour", () => {
    // The themed colour has to sit ABOVE the raster PNG in the background
    // stack: the PNG is only there to stop Brave's auto-dark rewriting the
    // layers over it (2026-09-12). jsdom loads no CSS, so this guards the
    // stylesheet itself.
    const css = readCss();
    expect(css).toContain("--re-led-on: var(--nova-led-color, #ffffff);");
    expect(css).toContain("--re-led-on-rgb: var(--nova-led-rgb, 255 255 255);");

    // Anchored on the rule's own comment: three selectors end in the same tail.
    const lit = css.slice(css.indexOf("/* The lit light takes its colour"));
    const rule = lit.slice(0, lit.indexOf("}"));
    expect(rule).toContain("background-color: var(--re-led-on, #ffffff);");
    // Themed gradient first (topmost), PNG underneath as the auto-dark guard.
    expect(rule.indexOf("linear-gradient(180deg, var(--re-led-on")).toBeLessThan(rule.indexOf("data:image/png"));
    // Both glows follow the colour, and keep their px floors.
    expect(rule).toContain("max(4px, calc(var(--re-led-w) * 1.3)) max(1px, calc(var(--re-led-w) * 0.35)) rgb(var(--re-led-on-rgb, 255 255 255) / 0.9)");
    expect(rule).toContain("max(9px, calc(var(--re-led-w) * 3)) max(2px, calc(var(--re-led-w) * 0.9)) rgb(var(--re-led-on-rgb, 255 255 255) / 0.45)");
  });

  it("ignores an incoming value while the drag is still in the hand", () => {
    // A zone reporting a waypoint of a fade must not yank a turn in progress.
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorEncoder activeChannel="brightness" value={{ ...start, v: 90 }} onChange={onChange} />,
    );
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, ...at(0), pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, ...at(degreesFor(30)), pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(100, 5);

    // Mid-drag echo of a much lower brightness: ignored.
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 12 }} onChange={onChange} />);
    fireEvent.pointerMove(dial, { buttons: 1, ...at(degreesFor(40)), pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBe(100);
    expect(dial.getAttribute("aria-valuenow")).toBe("100");

    // Once the gesture is over, a genuine outside change is taken.
    fireEvent.pointerUp(dial, { ...at(degreesFor(40)), pointerId: 1 });
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
    turn(dial, 12);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  const angleOf = (container: HTMLElement) =>
    (container.querySelector(".color-encoder") as HTMLElement).style.getPropertyValue("--re-angle");

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
    turn(dial, degreesFor(20));
    expect(dial.getAttribute("aria-valuenow")).toBe("100");
    expect(angleOf(container)).toBe("135.00deg");
    // Turning further past the end moves nothing.
    turn(dial, degreesFor(20));
    expect(angleOf(container)).toBe("135.00deg");
    // Reversing moves value and index at once — no wind-back through the overshoot.
    turn(dial, -degreesFor(10));
    expect(dial.getAttribute("aria-valuenow")).toBe("90");
    expect(angleOf(container)).toBe("108.00deg");
  });

  it("stops at zero too, for brightness and alpha", () => {
    for (const channel of ["brightness", "alpha"] as const) {
      const { container, unmount } = render(
        <Controlled channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} activeChannel={channel} initial={{ ...start, v: 3, a: 3 }} />,
      );
      turn(screen.getByRole("slider"), -degreesFor(20));
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("0");
      expect(angleOf(container)).toBe("-135.00deg");
      unmount();
    }
  });

  it("turns forever on hue, continuous across 360", () => {
    const { container } = render(<Controlled initial={start} />);
    turn(screen.getByRole("slider"), 500);
    // +500° of hue from 200°: the index has gone round, not snapped back to 340°.
    expect(angleOf(container)).toBe("700.00deg");
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("340");
  });

  it("glows only from half brightness up", () => {
    const { container, rerender } = render(<ColorEncoder value={{ ...start, v: 49 }} onChange={vi.fn()} />);
    const root = container.querySelector(".color-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--re-glow")).toBe("0 0 0 rgba(0, 0, 0, 0)");
    rerender(<ColorEncoder value={{ ...start, v: 100 }} onChange={vi.fn()} />);
    expect(root.style.getPropertyValue("--re-glow")).toMatch(/px rgba\(/);
  });

  it("clamps size to 50–200px", () => {
    const { container, rerender } = render(<ColorEncoder size={20} value={start} onChange={vi.fn()} />);
    const root = () => container.querySelector(".color-encoder") as HTMLElement;
    expect(root().style.getPropertyValue("--re-size")).toBe("50px");
    rerender(<ColorEncoder size={500} value={start} onChange={vi.fn()} />);
    expect(root().style.getPropertyValue("--re-size")).toBe("200px");
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
    // One arrow is 5.4° of turn, which on hue is 5.4°.
    expect(onChange.mock.lastCall?.[0].h).toBeCloseTo(205.4, 5);
    fireEvent.keyDown(dial, { key: "Enter" });
    expect(litChannel(container)).toBe("brightness");
  });
});
