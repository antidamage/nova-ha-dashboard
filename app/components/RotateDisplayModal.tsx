"use client";

import { RotateCwSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rotationSteps, useKioskRotation } from "./dashboard/kioskRotation";

export const MODAL_DISMISS_MS = 3000;

// The kiosk's rotation service puts this function on the page over CDP
// (ops/kiosk/nova-kiosk-rotate.py); a machine without the service has none.
type RotationBridge = Window & { novaKioskRotate?: (direction: string) => void };

/**
 * A plain outlined square with the rotate icon enlarged in the middle. Tapping
 * the icon turns the display 90 degrees clockwise, once per tap. A tap anywhere
 * else, or three seconds without a tap on the icon, dismisses it.
 *
 * It does not turn with the display. The page re-lays itself out in the new
 * orientation, so the square counter-rotates by the same amount and keeps the
 * orientation it had when it opened: the display turning counter-clockwise turns
 * the square clockwise. specs/kiosk-display-rotation.md.
 */
export function RotateDisplayModal({ onDismiss }: { onDismiss: () => void }) {
  const rotation = useKioskRotation();
  const [angle, setAngle] = useState(0);
  const [taps, setTaps] = useState(0);
  const previous = useRef(rotation);

  useEffect(() => {
    const before = previous.current;
    previous.current = rotation;
    if (before && rotation) setAngle((current) => current - 90 * rotationSteps(before, rotation));
  }, [rotation]);

  // Restarts on every tap on the icon: "not tapping it for three seconds".
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, MODAL_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [taps, onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div className="rotate-modal-backdrop" role="dialog" aria-modal="true" aria-label="Rotate display" onClick={onDismiss}>
      <div className="rotate-modal-box" style={{ transform: `rotate(${angle}deg)` }}>
        <button
          type="button"
          className="rotate-modal-icon"
          aria-label="Rotate display clockwise"
          onClick={(event) => {
            event.stopPropagation();
            const rotate = (window as RotationBridge).novaKioskRotate;
            if (typeof rotate === "function") {
              rotate("clockwise");
            } else {
              console.warn("Display rotation is allowed here, but this machine has no rotation service.");
            }
            setTaps((count) => count + 1);
          }}
        >
          <RotateCwSquare className="rotate-modal-svg" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
