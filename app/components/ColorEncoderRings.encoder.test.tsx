import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder } from "./ColorEncoder";
import { RING_LIMIT, fractionAt, ringGeometry } from "./rotaryEncoderGeometry";
import { Controlled, at, start, svgOf, thumbOf, useDialHarness } from "./ColorEncoderRings.fixtures";

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

  it("does nothing for a tap on the track away from the thumb", () => {
    const change = vi.fn();
    const commit = vi.fn();
    const { container } = render(<Controlled spy={{ change, commit }} initial={[10]} />);
    const radius = ringGeometry(200, 1, true).radii[0];
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, 60) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 60) });
    expect(change).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole("slider", { name: "Ring 0" }).getAttribute("aria-valuenow")).toBe("10");
  });

  it("grabs the thumb where it was pressed, so an off-centre grab never jumps it", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} initial={[50]} />);
    const { radius, angle } = thumbOf(50);
    const svg = svgOf(container);
    // Pressed near one end of the thumb: nothing moves on the press itself.
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angle + 6) });
    expect(change).not.toHaveBeenCalled();
    // Dragged on by the thumb's own distance from 50 to 70: it lands on 70.
    const travel = thumbOf(70).angle - angle;
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle + 6 + travel) });
    expect(change.mock.lastCall?.[1]).toBeCloseTo(70, 5);
  });

  it("grabs the thumb that was pressed when two rings' thumbs line up", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} rings={2} initial={[50, 50]} />);
    const inner = thumbOf(50, 0, 2);
    const outer = thumbOf(50, 1, 2);
    const svg = svgOf(container);
    // Just outside the half-way line between the two tracks belongs to the outer ring.
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at((inner.radius + outer.radius) / 2 + 0.5, outer.angle) });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(outer.radius, thumbOf(80, 1, 2).angle) });
    expect(change.mock.lastCall?.[0]).toBe(1);
  });

  it("ignores a press in the label gap, even with the thumb at the end beside it", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} initial={[0]} />);
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
    const { radius, angle } = thumbOf(80);
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
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
    // Titled, so the ring sits where `thumbOf` puts it.
    const { container } = render(<ColorEncoder label="Lights" value={start} onChange={vi.fn()} rings={rings} />);
    // Dead on its thumb, and dragged: a disabled ring's thumb cannot be grabbed.
    const { radius, angle } = thumbOf(20);
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, angle) });
    fireEvent.pointerMove(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, angle + 40) });
    fireEvent.keyDown(screen.getByRole("slider", { name: "A" }), { key: "ArrowRight" });
    expect(change).not.toHaveBeenCalled();
  });
});
