import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder } from "./ColorEncoder";
import { RING_LIMIT, fractionAt, ringGeometry } from "./rotaryEncoderGeometry";
import { Controlled, at, start, svgOf, useDialHarness } from "./ColorEncoderRings.fixtures";

useDialHarness();

describe("ColorEncoder", () => {
  it("curves the label around the outside of the knob, not on its face", () => {
    const { container } = render(<ColorEncoder label="Lights" value={start} onChange={vi.fn()} />);
    const title = container.querySelector(".rotary-encoder-title-arc .rotary-encoder-title");
    expect(title?.textContent).toBe("Lights");
    expect(container.querySelector(".rotary-encoder-dial .rotary-encoder-label")).toBeNull();
    expect(screen.getByRole("slider", { name: "Lights" })).toBeTruthy();
  });

  it("draws one slider per ring, up to five, and warns past that", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rings = Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, label: `R${index}`, value: 0, onChange: vi.fn() }));
    render(<ColorEncoder value={start} onChange={vi.fn()} rings={rings} />);
    expect(screen.getAllByRole("slider")).toHaveLength(1 + RING_LIMIT);
    expect(warn).toHaveBeenCalled();
  });

  it("jumps the thumb to a tap on the track", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} initial={[10]} />);
    const radius = ringGeometry(200, 1, true).radii[0];
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 0) });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.lastCall?.[1]).toBeCloseTo(50, 5);
    expect(screen.getByRole("slider", { name: "Ring 0" }).getAttribute("aria-valuenow")).toBe("50");
  });

  it("ignores a press in the label gap", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} />);
    const radius = ringGeometry(200, 1, true).radii[0];
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 180) });
    expect(change).not.toHaveBeenCalled();
  });

  it("drags the outer ring along the arc and commits once", () => {
    const change = vi.fn();
    const commit = vi.fn();
    const { container } = render(<Controlled rings={3} spy={{ change, commit }} />);
    const geometry = ringGeometry(200, 3, true);
    const radius = geometry.radii[2];
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
    for (const angle of [20, 40, 60, 90]) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 90) });
    expect(change.mock.calls.every(([index]) => index === 2)).toBe(true);
    const expected = fractionAt(90, geometry.thumbHalfAngle[2]) * 100;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(expected, 5);
  });

  it("holds at the end when a drag runs on into the gap", () => {
    const commit = vi.fn();
    const { container } = render(<Controlled spy={{ commit }} initial={[80]} />);
    const radius = ringGeometry(200, 1, true).radii[0];
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 100) });
    for (const angle of [130, 160, -170, -140, -100]) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, -100) });
    expect(commit.mock.lastCall?.[1]).toBe(100);
  });

  it("steps with the arrow keys, finer with Shift, committing on key up", () => {
    const commit = vi.fn();
    render(<Controlled spy={{ commit }} />);
    const ring = screen.getByRole("slider", { name: "Ring 0" });
    fireEvent.keyDown(ring, { key: "ArrowRight" });
    fireEvent.keyUp(ring, { key: "ArrowRight" });
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(51);
    fireEvent.keyDown(ring, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyUp(ring, { key: "ArrowLeft", shiftKey: true });
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(51 - 1 / 8);
  });

  it("takes no input on a disabled ring", () => {
    const change = vi.fn();
    const rings = [{ id: "a", label: "A", value: 20, disabled: true, onChange: change }];
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} rings={rings} />);
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(ringGeometry(200, 1, true).radii[0], 0) });
    fireEvent.keyDown(screen.getByRole("slider", { name: "A" }), { key: "ArrowRight" });
    expect(change).not.toHaveBeenCalled();
  });
});
