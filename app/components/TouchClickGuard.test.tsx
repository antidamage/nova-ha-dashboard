import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TouchClickGuard } from "./TouchClickGuard";

function firePointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
  });

  target.dispatchEvent(event);
}

function renderButton(onClick = vi.fn()) {
  render(
    <>
      <TouchClickGuard />
      <button type="button" onClick={onClick}>
        Lights
      </button>
    </>,
  );

  return { button: screen.getByRole("button", { name: "Lights" }), onClick };
}

describe("TouchClickGuard", () => {
  it("allows a touch tap to click normally", () => {
    const { button, onClick } = renderButton();

    firePointer(button, "pointerdown", 20, 20);
    firePointer(button, "pointerup", 20, 20);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses the click synthesized after a touch scroll gesture", () => {
    const { button, onClick } = renderButton();

    firePointer(button, "pointerdown", 20, 20);
    firePointer(button, "pointermove", 20, 44);
    firePointer(button, "pointerup", 20, 44);
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
