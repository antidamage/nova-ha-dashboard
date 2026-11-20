"use client";

import type { Point } from "./gesture-model";

/**
 * Turns the finger's samples into the events the real component code listens
 * to (specs/tutorial-mode.md, "Synthetic gestures"). Pointer mode drives the
 * sandbox copies; mouse mode drives the real Advanced fold, whose drag listens
 * to mousedown on itself and mousemove/mouseup on the window.
 */

export const FINGER_POINTER_ID = 7071;

export type DispatchMode = "pointer" | "mouse";

/** What is under the finger, ignoring the mask and the finger itself. */
export function elementAt(point: Point, within: (element: Element) => boolean): Element | null {
  const stack = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(point.x, point.y)
    : [document.elementFromPoint(point.x, point.y)].filter((element): element is Element => element !== null);
  return stack.find((element) => within(element)) ?? null;
}

function pointerEvent(type: string, point: Point, pressed: boolean) {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    pointerId: FINGER_POINTER_ID,
    pointerType: "touch",
    isPrimary: true,
    button: type === "pointermove" ? -1 : 0,
    buttons: pressed ? 1 : 0,
    width: 20,
    height: 20,
    pressure: pressed ? 0.5 : 0,
  };
  return typeof PointerEvent === "function" ? new PointerEvent(type, init) : new MouseEvent(type, init);
}

function mouseEvent(type: string, point: Point, pressed: boolean) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons: pressed ? 1 : 0,
  });
}

/**
 * One press, from down to up. The target is fixed at the down, as pointer
 * capture would fix it; moves and the up go to it.
 */
export class FingerPress {
  private target: Element | null = null;
  private travel = 0;
  private last: Point | null = null;

  constructor(private readonly mode: DispatchMode, private readonly within: (element: Element) => boolean) {}

  down(point: Point) {
    this.target = elementAt(point, this.within);
    this.travel = 0;
    this.last = point;
    if (!this.target) return;
    if (this.mode === "pointer") this.target.dispatchEvent(pointerEvent("pointerdown", point, true));
    this.target.dispatchEvent(mouseEvent("mousedown", point, true));
  }

  move(point: Point) {
    if (!this.target || !this.last) return;
    this.travel += Math.hypot(point.x - this.last.x, point.y - this.last.y);
    this.last = point;
    if (this.mode === "pointer") this.target.dispatchEvent(pointerEvent("pointermove", point, true));
    else window.dispatchEvent(mouseEvent("mousemove", point, true));
  }

  up(point: Point) {
    const target = this.target;
    this.target = null;
    if (!target) return;
    if (this.mode === "pointer") {
      target.dispatchEvent(pointerEvent("pointerup", point, false));
      target.dispatchEvent(mouseEvent("mouseup", point, false));
      // A tap is also a click, for the buttons that listen for one.
      if (this.travel < 5) target.dispatchEvent(mouseEvent("click", point, false));
    } else {
      window.dispatchEvent(mouseEvent("mouseup", point, false));
    }
  }

  cancel() {
    const target = this.target;
    this.target = null;
    if (target && this.mode === "pointer") target.dispatchEvent(pointerEvent("pointercancel", this.last ?? { x: 0, y: 0 }, false));
    if (target && this.mode === "mouse") window.dispatchEvent(mouseEvent("mouseup", this.last ?? { x: 0, y: 0 }, false));
  }
}
