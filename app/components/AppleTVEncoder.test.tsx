import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppleTVEncoder } from "./AppleTVEncoder";
import { VOLUME_RING_MID } from "./appleTVEncoderModel";

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

  it("paints its ring in the blue-green, with the level's gradient shift", () => {
    const { container } = render(
      <AppleTVEncoder muted={false} volume={60} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
    );
    const root = container.querySelector<HTMLElement>(".apple-tv-encoder");
    expect(root?.style.getPropertyValue("--re-ring-paint")).toContain("conic-gradient");
    // The shift runs 90° at rest to 270° at full: at 60% it is 198°.
    expect(root?.style.getPropertyValue("--re-ring-paint")).toContain("198.00deg");
    // volumeColour(60): 20% from the blue-green toward the pale mint.
    expect(root?.style.getPropertyValue("--re-color")).toBe("rgb(47, 209, 174)");
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

  it("is still blue-green at rest, at the deep end of the family", () => {
    const { container } = render(
      <AppleTVEncoder muted={false} volume={0} onMuteChange={() => undefined} onVolumeChange={() => undefined} />,
    );
    const colour = container.querySelector<HTMLElement>(".apple-tv-encoder")?.style.getPropertyValue("--re-color");
    expect(colour).toBe("rgb(14, 127, 122)");
    expect(colour).not.toBe(VOLUME_RING_MID);
  });
});
