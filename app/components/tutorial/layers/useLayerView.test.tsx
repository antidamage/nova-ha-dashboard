// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TUTORIAL_STEPS, type TutorialStep } from "../steps";
import { useLayerView } from "./useLayerView";

const stepById = (id: string) => TUTORIAL_STEPS.find((step) => step.id === id)!;

// jsdom has no hit testing; the synthetic tap just finds nothing to press.
if (typeof document.elementFromPoint !== "function") document.elementFromPoint = () => null;

describe("useLayerView", () => {
  // PR #185 review 518: Next during the ~1.1s wait for a locked knob to unfold
  // let the old step's open land on the new step.
  it("drops an open that is overtaken by a step change", async () => {
    vi.useFakeTimers();
    const copy = document.createElement("div");
    copy.innerHTML = '<div class="rotary-encoder" data-locked="true"><div class="rotary-encoder-dial"></div></div>';
    document.body.appendChild(copy);
    const copyRef = { current: copy };
    const { result, rerender } = renderHook(({ step }: { step: TutorialStep }) => useLayerView(step, copyRef, () => undefined), {
      initialProps: { step: stepById("unlock") },
    });
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = result.current.open();
    });
    expect(result.current.opening).toBe(true);
    rerender({ step: stepById("target-and-modes") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      await opening;
    });
    expect(result.current.view).toBeNull();
    expect(result.current.opening).toBe(false);
    vi.useRealTimers();
    copy.remove();
  });

  it("opens on the step it was asked on", async () => {
    vi.useFakeTimers();
    const copy = document.createElement("div");
    copy.innerHTML = '<div class="rotary-encoder" data-locked="false"><div class="rotary-encoder-dial"></div></div>';
    document.body.appendChild(copy);
    const copyRef = { current: copy };
    const { result } = renderHook(() => useLayerView(stepById("tap-vs-turn"), copyRef, () => undefined));
    await act(async () => {
      await result.current.open();
    });
    expect(result.current.view?.setId).toBe("rotary");
    vi.useRealTimers();
    copy.remove();
  });
});
