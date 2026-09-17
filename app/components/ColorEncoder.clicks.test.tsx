import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { readCss } from "../styles/readCss";
import * as haptics from "./haptics";
import { ColorEncoder } from "./ColorEncoder";
import { type Hsva } from "./colorEncoderModel";
import { at, start, turn, useDialHarness } from "./ColorEncoder.fixtures";

useDialHarness();

describe("ColorEncoder", () => {
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
});
