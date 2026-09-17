import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DotEnvelopeControl,
  DotRangeControl,
} from "../../DotControls";

describe("DotEnvelopeControl", () => {
  afterEach(cleanup);

  it("shows individual phase durations and keeps equal-time boundaries side by side", () => {
    render(<DotEnvelopeControl ariaLabel="Pulse envelope" max={12} step={0.05} value={[1, 0, 0]} onChange={() => {}} />);

    expect(screen.getByText("1.0s")).toBeInTheDocument();
    expect(screen.getAllByText("0.0s")).toHaveLength(2);
    expect(screen.getByText("ATK")).toBeInTheDocument();
    expect(screen.getByText("HLD")).toBeInTheDocument();
    expect(screen.getByText("REL")).toBeInTheDocument();
    const attack = screen.getByRole("slider", { name: "Pulse envelope attack end" });
    const hold = screen.getByRole("slider", { name: "Pulse envelope hold end" });
    const release = screen.getByRole("slider", { name: "Pulse envelope release end" });
    expect(attack).toHaveAttribute("aria-valuenow", "1");
    expect(hold).toHaveAttribute("aria-valuenow", "1");
    expect(release).toHaveAttribute("aria-valuenow", "1");
    expect(hold.style.left).not.toBe(attack.style.left);
    expect(release.style.left).not.toBe(hold.style.left);
  });

  // The thumbs push rather than block, and only ever rightwards: the three
  // boundaries are cumulative, so moving attack must not silently rewrite the
  // phases after it.
  describe("pushing thumbs", () => {
    const renderEnvelope = (value: [number, number, number]) => {
      const onChange = vi.fn();
      render(<DotEnvelopeControl ariaLabel="Envelope" max={12} step={0.05} value={value} onChange={onChange} />);
      return {
        attack: screen.getByRole("slider", { name: "Envelope attack end" }),
        hold: screen.getByRole("slider", { name: "Envelope hold end" }),
        onChange,
        release: screen.getByRole("slider", { name: "Envelope release end" }),
      };
    };

    it("carries hold and release along when attack moves", () => {
      const { attack, onChange } = renderEnvelope([1, 2, 3]);

      // A 0.05 step still moves by the finest decimal it expresses, 0.01.
      fireEvent.keyDown(attack, { key: "ArrowRight" });
      expect(onChange).toHaveBeenLastCalledWith([1.01, 2, 3]);

      fireEvent.keyDown(attack, { key: "ArrowLeft" });
      expect(onChange).toHaveBeenLastCalledWith([0.99, 2, 3]);
    });

    it("shrinks the carried phases rather than pushing them off the end", () => {
      const { attack, onChange } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(attack, { key: "End" });

      expect(onChange).toHaveBeenLastCalledWith([12, 0, 0]);
    });

    it("stops hold against attack without moving it, and carries release", () => {
      const { hold, onChange } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(hold, { key: "Home" });
      expect(onChange).toHaveBeenLastCalledWith([1, 0, 3]);

      fireEvent.keyDown(hold, { key: "End" });
      expect(onChange).toHaveBeenLastCalledWith([1, 11, 0]);
    });

    it("lets release be pushed by hold but never push it back", () => {
      const { onChange, release } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(release, { key: "Home" });
      expect(onChange).toHaveBeenLastCalledWith([1, 2, 0]);

      fireEvent.keyDown(release, { key: "End" });
      expect(onChange).toHaveBeenLastCalledWith([1, 2, 9]);
    });
  });
});

describe("DotRangeControl", () => {
  afterEach(cleanup);

  it("pushes the other thumb along instead of blocking against it", () => {
    const onChange = vi.fn();
    render(
      <DotRangeControl ariaLabel="Range" min={0} max={100} step={1} value={[20, 50]} onChange={onChange} />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Range minimum" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith([100, 100]);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Range maximum" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith([0, 0]);
  });
});
