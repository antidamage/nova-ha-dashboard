import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder, COLOR_ENCODER_CHANNELS_WITH_ALPHA } from "./ColorEncoder";
import { litChannel, start, tap, useDialHarness } from "./ColorEncoder.fixtures";

useDialHarness();

describe("ColorEncoder", () => {
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
