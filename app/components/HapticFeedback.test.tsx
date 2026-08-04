import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HapticFeedback } from "./HapticFeedback";

describe("HapticFeedback", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("gives enabled native and ARIA buttons one tiny click", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const view = render(
      <>
        <HapticFeedback />
        <button type="button"><span>Native</span></button>
        <div role="button">ARIA</div>
      </>,
    );

    fireEvent.click(view.getByText("Native"));
    fireEvent.click(view.getByText("ARIA"));

    expect(vibrate).toHaveBeenNthCalledWith(1, 12);
    expect(vibrate).toHaveBeenNthCalledWith(2, 12);
  });

  it("stays silent for disabled actions", () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const view = render(
      <>
        <HapticFeedback />
        <button type="button" disabled>Native</button>
        <div role="button" aria-disabled="true">ARIA</div>
      </>,
    );

    fireEvent.click(view.getByText("Native"));
    fireEvent.click(view.getByText("ARIA"));

    expect(vibrate).not.toHaveBeenCalled();
  });
});
