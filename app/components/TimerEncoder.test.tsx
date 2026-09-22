import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ringGeometry } from "./controls/rotary/geometry-model";
import { timerMinutesToFraction } from "./timerEncoderMath";
import { DIAL_BOX, at, useDialHarness } from "./controls/rotary/RotaryEncoder.fixtures";

// The knob sets the time and the ring round it picks the icon
// (specs/status-orb-stack.md, "Set-timer control"). The dial and the ring have
// swapped jobs, and the icon has no reading of its own: it changes on the face.

const orb = vi.hoisted(() => ({
  command: vi.fn(async () => ({})),
  icons: [
    { id: "timer", label: "Countdown", glyph: { kind: "phosphor" as const, id: "timer" } },
    { id: "cake", label: "Cake", glyph: { kind: "phosphor" as const, id: "cake" } },
    { id: "tea", label: "Tea", glyph: { kind: "text" as const, value: "T" } },
  ],
}));

vi.mock("./orb-info/useOrbTimer", () => ({ useOrbTimer: () => ({ timer: null, now: Date.now(), command: orb.command }) }));
vi.mock("./orb-info/useOrbSettings", () => ({ useOrbSettings: () => ({ icons: orb.icons, entries: [], hasWashing: false, hasTimer: true }) }));
vi.mock("./dashboard/controlSound", () => ({ playUxSound: vi.fn() }));

import { TimerEncoder } from "./TimerEncoder";

useDialHarness();

const CENTRE = DIAL_BOX / 2;

/** A point on the knob, in the client coordinates the dial measures against. */
function onKnob(radius: number, angle: number) {
  const point = at(radius, angle);
  return { clientX: CENTRE + point.clientX, clientY: CENTRE + point.clientY };
}

const dial = () => screen.getByRole("slider", { name: "Set household timer" });
const face = () => document.querySelector(".timer-encoder-face")?.textContent;
const field = () => screen.queryByRole("button", { name: "Type the timer minutes" });

describe("TimerEncoder", () => {
  /** The dial's clock, so an unlocking tap's 60–400 ms window can be met. */
  function clock() {
    let time = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    return { advance: (ms: number) => { time += ms; } };
  }

  function tapDial(time: { advance: (ms: number) => void }, held = 120) {
    const knob = dial();
    fireEvent.pointerDown(knob, { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
    time.advance(held);
    fireEvent.pointerUp(knob, { clientX: 40, clientY: 40, pointerId: 1 });
  }

  function turnKnob(from: number, to: number) {
    const knob = dial();
    fireEvent.pointerDown(knob, { buttons: 1, pointerId: 1, ...onKnob(90, from) });
    fireEvent.pointerMove(knob, { buttons: 1, pointerId: 1, ...onKnob(90, to) });
    fireEvent.pointerUp(knob, { pointerId: 1, ...onKnob(90, to) });
  }

  /**
   * The turn that takes the dial's value from `from` to `to`, read off the range
   * the dial itself advertises. The assertions below stay literal - the gesture
   * is the means, not the expectation.
   */
  function sweepFor(from: number, to: number) {
    const min = Number(dial().getAttribute("aria-valuemin"));
    const max = Number(dial().getAttribute("aria-valuemax"));
    return ((to - from) / (max - min)) * 270;
  }

  function turnToTenMinutes(from = -60) {
    turnKnob(from, from + sweepFor(0, timerMinutesToFraction(10)));
  }

  function pressRing(index = 130) {
    const svg = document.querySelector("svg.rotary-encoder-rings")!;
    const radius = ringGeometry(200, 1, true).radii[0];
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 2, ...at(radius, index) });
    fireEvent.pointerUp(svg, { pointerId: 2, ...at(radius, index) });
  }

  beforeEach(() => {
    orb.command.mockReset();
    orb.command.mockResolvedValue({});
  });

  it("sets the time on the knob, and shows it on the face as it turns", () => {
    vi.useFakeTimers();
    const time = clock();
    render(<TimerEncoder />);
    expect(face()).toBe("Off");

    // One deliberate tap opens it (the dial's own tuck rules).
    tapDial(time);

    // The turn that lands ten minutes on the log scale the ring used to carry,
    // on the same graduated detents.
    turnToTenMinutes();
    expect(face()).toBe("10:00");
    expect(dial()).toHaveAttribute("aria-valuetext", "10:00");

    act(() => vi.advanceTimersByTime(5000));
    expect(orb.command).toHaveBeenCalledWith({ command: "set", durationMs: 600_000, icon: "timer", label: "Countdown" });
  });

  it("picks the icon on the outer ring, with no reading at its end", () => {
    vi.useFakeTimers();
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    turnToTenMinutes();

    const svg = document.querySelector("svg.rotary-encoder-rings");
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('[data-ring-id="icon"]')).not.toBeNull();
    // No icon text at the ring's end: the face carries the icon instead.
    expect(svg?.querySelector(".rotary-encoder-ring-value")).toBeNull();

    pressRing();
    // A press on the ring is not a tap on the knob: the field stays shut.
    expect(screen.queryByRole("dialog", { name: "Timer minutes" })).toBeNull();
    // The last icon of the three is a text glyph, so it shows on the face.
    expect(document.querySelector(".reminder-glyph-text")?.textContent).toBe("T");

    // And a tap on the knob — the same gesture the ring's press must not be —
    // does open it.
    tapDial(time);
    vi.useRealTimers();
    // Closing the field commits: the duration the knob set, with the icon the
    // ring picked. The field itself is portalled, so it is read from the dialog.
    const dialog = screen.getByRole("dialog", { name: "Timer minutes" });
    fireEvent.keyDown(dialog.querySelector("input")!, { key: "Escape" });
    expect(orb.command).toHaveBeenCalledWith({ command: "set", durationMs: 600_000, icon: "text:T", label: "Tea" });
  });

  it("keeps the smallest turn inside the dial's own range", () => {
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    // Under a degree of sweep is the 20 s detent, whose logarithmic fraction
    // comes out below zero: the dial must not be handed a value under its min.
    turnKnob(-60, -59.6);
    expect(face()).toBe("0:20");
    const now = dial().getAttribute("aria-valuenow");
    const min = dial().getAttribute("aria-valuemin");
    expect(now).not.toBeNull();
    expect(Number(now)).toBeGreaterThanOrEqual(Number(min));
  });

  it("turns back to Off from the smallest duration a turn reaches", () => {
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    turnKnob(-60, -59.6);
    expect(face()).toBe("0:20");
    // One more leftward step has to cross back to Off rather than sit at a dead
    // bottom end (the dial's floor is one detent under the 20 s fraction).
    turnKnob(-59.6, -60.1);
    expect(face()).toBe("Off");
  });

  it("keeps a typed sub-20 s duration inside the dial's own range", () => {
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    tapDial(time);
    const input = screen.getByRole("dialog", { name: "Timer minutes" }).querySelector("input")!;
    fireEvent.change(input, { target: { value: "0.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // 15 s is what the face shows and what the dial keeps in range: its fraction
    // is far below the bottom of the turn, so the dial parks there.
    expect(face()).toBe("0:15");
    const now = dial().getAttribute("aria-valuenow");
    expect(now).not.toBeNull();
    expect(Number(now)).toBeGreaterThanOrEqual(Number(dial().getAttribute("aria-valuemin")));
    // And what commits is the typed duration, not the dial's position.
    expect(orb.command).toHaveBeenCalledWith({ command: "set", durationMs: 15_000, icon: "timer", label: "Countdown" });
  });

  it("does not read Off on the way up out of the smallest duration", () => {
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    turnKnob(-60, -59.5);
    expect(face()).toBe("0:20");
    // The detent sits above Off, so turning up leaves it without dipping away.
    turnKnob(-59.5, -57.5);
    expect(face()).toBe("0:25");
  });

  it("asks for exact minutes when the open knob is tapped", async () => {
    const time = clock();
    render(<TimerEncoder />);
    tapDial(time);
    // The tap that opened it is the unlock, not the field.
    expect(screen.queryByRole("dialog", { name: "Timer minutes" })).toBeNull();

    tapDial(time);
    expect(await screen.findByRole("dialog", { name: "Timer minutes" })).toBeInTheDocument();
  });

  it("opens the field from the reading itself, which is its keyboard door", async () => {
    const time = clock();
    const { container } = render(<TimerEncoder />);
    const button = () => container.querySelector(".timer-encoder-field");
    expect(button()).toHaveAttribute("tabindex", "-1");
    expect(field()).toBeNull();

    tapDial(time);
    expect(button()).toHaveAttribute("tabindex", "0");
    // The dial's own Enter handler preventDefaults, which is what the browser
    // would turn into this button's click: the key must not be swallowed.
    expect(fireEvent.keyDown(field()!, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(field()!, { key: " " })).toBe(true);
    // What Enter or Space on a button does.
    fireEvent.click(field()!);
    expect(await screen.findByRole("dialog", { name: "Timer minutes" })).toBeInTheDocument();
  });
});
