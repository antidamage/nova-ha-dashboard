import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppleTVEncoder } from "./AppleTVEncoder";

/** The 133px dial's box: --re-outer is DIAL_OUTER_RATIO knob diameters. */
const DIAL_BOX = 133 * 1.314;

beforeAll(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined;
  }
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
    if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
    return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A tap on the knob: press and release without moving. It is what cycles the lights. */
function tapDial() {
  const dial = screen.getByRole("slider");
  let time = 1000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => time);
  fireEvent.pointerDown(dial, { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
  time += 120;
  fireEvent.pointerUp(dial, { pointerId: 1 });
  spy.mockRestore();
}

describe("the Apple TV dial", () => {
  it("shows the volume on its face and names itself", () => {
    render(<AppleTVEncoder muted={false} volume={42} onMuteChange={() => undefined} onVolumeChange={() => undefined} />);
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("VOLUME")).toBeTruthy();
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe("volume 42 percent, unmuted");
  });

  it("paints its ring in the status orb's ring colour, with a glow in the same colour", () => {
    const { container } = render(
      <AppleTVEncoder muted={false} volume={60} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
    );
    const root = container.querySelector<HTMLElement>(".apple-tv-encoder");
    expect(root?.style.getPropertyValue("--re-color")).toBe("var(--cyber-line)");
    expect(root?.style.getPropertyValue("--re-ring-paint")).toBe("");
    // size 200 (the dial's default): blur 200*0.12*0.6, spread 200*0.012*0.6.
    expect(root?.style.getPropertyValue("--re-glow")).toBe("0 0 14.4px 1.4px rgb(var(--cyber-line-rgb) / 0.372)");
  });

  it("lights the volume mode, and the mute mode while muted", () => {
    const { rerender } = render(
      <AppleTVEncoder muted={false} volume={30} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
    );
    const lit = () => screen.getByRole("slider").getAttribute("data-led");
    expect(lit()).toBe("volume");
    rerender(<AppleTVEncoder muted volume={30} onMuteChange={() => undefined} onVolumeChange={() => undefined} />);
    expect(lit()).toBe("mute");
    expect(screen.getByText("MUTED")).toBeTruthy();
  });

  it("toggles mute when its lights are cycled, and unmutes when cycled back", () => {
    const onMuteChange = vi.fn();
    const { rerender } = render(
      <AppleTVEncoder muted={false} volume={30} onMuteChange={onMuteChange} onVolumeChange={() => undefined} />,
    );
    tapDial();
    expect(onMuteChange).toHaveBeenCalledWith(true);

    rerender(<AppleTVEncoder muted volume={30} onMuteChange={onMuteChange} onVolumeChange={() => undefined} />);
    tapDial();
    expect(onMuteChange).toHaveBeenLastCalledWith(false);
  });

  it("turns the volume by the angle swept, one percent at a time", () => {
    const onVolumeChange = vi.fn();
    render(<AppleTVEncoder muted={false} volume={40} onMuteChange={() => undefined} onVolumeChange={onVolumeChange} />);
    const dial = screen.getByRole("slider");
    const angle = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180;
      return { clientX: DIAL_BOX / 2 + Math.sin(radians) * DIAL_BOX * 0.3, clientY: DIAL_BOX / 2 - Math.cos(radians) * DIAL_BOX * 0.3 };
    };
    fireEvent.pointerDown(dial, { buttons: 1, pointerId: 1, ...angle(0) });
    // 27° is a tenth of the 270° sweep, so a tenth of the range.
    fireEvent.pointerMove(dial, { buttons: 1, pointerId: 1, ...angle(27) });
    expect(onVolumeChange).toHaveBeenCalled();
    const last = onVolumeChange.mock.calls.at(-1)?.[0] as number;
    expect(last).toBeGreaterThan(40);
    expect(last).toBeLessThanOrEqual(51);
  });

  it("carries every shading layer the other dials' knobs carry", () => {
    const { container } = render(
      <AppleTVEncoder muted={false} volume={40} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
    );
    // The same stack of layers every RotaryEncoder dial is built from — the
    // recessed bezel, the sunken channel and its shading, the lip, the embossed
    // unlock band with its glass, lit layer and specular streaks, the knob, its
    // rotor and the index on it. A dial that skipped one of these would read as
    // a different component (alex, 2026-09-22).
    const layers = [
      "rotary-encoder-outer-bevel",
      "rotary-encoder-glow",
      "rotary-encoder-ring",
      "rotary-encoder-ring-shade",
      "rotary-encoder-inner-bevel",
      "rotary-encoder-unlock-ring",
      "rotary-encoder-unlock-glass",
      "rotary-encoder-unlock-lit",
      "rotary-encoder-unlock-shift",
      "rotary-encoder-unlock-spec",
      "rotary-encoder-knob",
      "rotary-encoder-rotor",
      "rotary-encoder-index",
      "rotary-encoder-spec",
    ];
    for (const layer of layers) {
      expect(container.querySelectorAll(`.${layer}`).length, layer).toBe(1);
    }
  });

  it("clamps its size once, so a dial drawn at the ceiling is not glowing past it", () => {
    const reads = (size: number) => {
      const { container, unmount } = render(
        <AppleTVEncoder muted={false} volume={100} size={size} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
      );
      const root = container.querySelector<HTMLElement>(".apple-tv-encoder");
      const read = {
        resize: root?.style.getPropertyValue("--re-size"),
        glow: root?.style.getPropertyValue("--re-glow"),
      };
      unmount();
      return read;
    };
    const oversize = reads(260);
    const atCeiling = reads(200);
    expect(oversize).toEqual(atCeiling);
    // And the glow really does scale with the dial it was drawn at: 200*0.12.
    expect(atCeiling.glow).toBe("0 0 24.0px 2.4px rgb(var(--cyber-line-rgb) / 0.620)");
  });
});
