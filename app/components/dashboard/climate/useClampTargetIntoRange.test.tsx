import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClampTargetIntoRange } from "./useClampTargetIntoRange";

function Probe({ target, send }: { target: number; send: (next: number) => void }) {
  useClampTargetIntoRange(target, { min: 16, max: 30 }, false, send);
  return null;
}

afterEach(cleanup);

describe("useClampTargetIntoRange", () => {
  it("clamps an out-of-range target once", () => {
    const send = vi.fn();
    const { rerender } = render(<Probe target={10} send={send} />);
    rerender(<Probe target={10} send={send} />);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(16);
  });

  it("clamps a different out-of-range target without an in-range value between", () => {
    // Regression: the dedupe key had lost its interpolation and was the
    // constant "::", so the second target below was never clamped.
    const send = vi.fn();
    const { rerender } = render(<Probe target={10} send={send} />);
    rerender(<Probe target={35} send={send} />);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(30);
  });

  it("does not send for an in-range target", () => {
    const send = vi.fn();
    render(<Probe target={22} send={send} />);
    expect(send).not.toHaveBeenCalled();
  });
});
