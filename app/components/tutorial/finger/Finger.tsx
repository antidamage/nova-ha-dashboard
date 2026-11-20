"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { FingerView } from "./useFingerDriver";

export type FingerHandle = { draw: (view: FingerView) => void };

/**
 * The drawn fingertip (specs/tutorial-mode.md, "The finger"): a soft pad with
 * a press ring that draws in while pressed. Positioned per frame by the driver
 * through `draw`, outside React, so following a gesture never re-renders the
 * tour. It takes no input.
 */
export const Finger = forwardRef<FingerHandle>(function Finger(_, ref) {
  const element = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => ({
    draw: ({ point, pressed }) => {
      const node = element.current;
      if (!node) return;
      if (!point) {
        node.dataset.visible = "false";
        return;
      }
      node.dataset.visible = "true";
      node.dataset.pressed = pressed ? "true" : "false";
      node.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
    },
  }), []);
  return (
    <div ref={element} className="tutorial-finger" data-visible="false" data-pressed="false" aria-hidden="true">
      <span className="tutorial-finger-ring" />
      <span className="tutorial-finger-pad" />
    </div>
  );
});
