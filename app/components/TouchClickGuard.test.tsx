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

function renderTapAction(onClick = vi.fn()) {
  render(
    <>
      <TouchClickGuard />
      <table>
        <tbody>
          <tr data-tap-action="true" onClick={onClick}>
            <td>2:05 PM</td>
          </tr>
        </tbody>
      </table>
    </>,
  );

  const cell = screen.getByText("2:05 PM");

  return { row: cell.closest("tr") as HTMLTableRowElement, onClick };
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

  it("suppresses that click for an element that acts on a tap without being a control", () => {
    const { row, onClick } = renderTapAction();

    firePointer(row, "pointerdown", 20, 20);
    firePointer(row, "pointermove", 20, 44);
    firePointer(row, "pointerup", 20, 44);
    fireEvent.click(row);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("still lets a touch tap act on it", () => {
    // The positive control for the case above: without it, a guard that never
    // recorded the gesture would read as a pass (specs/power-meters.md §5.3).
    const { row, onClick } = renderTapAction();

    firePointer(row, "pointerdown", 20, 20);
    firePointer(row, "pointerup", 20, 20);
    fireEvent.click(row);

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
