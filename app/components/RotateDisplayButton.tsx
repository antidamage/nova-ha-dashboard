"use client";

import { RotateCwSquare } from "lucide-react";
import { useDisplayRotation } from "./dashboard/displayRotationSetting";

// The kiosk's display-rotation service puts this function on the page over CDP
// (ops/kiosk/nova-kiosk-rotate.py); a machine without the service has none.
type RotationBridge = Window & { novaKioskRotate?: (direction: string) => void };

/**
 * Turns the display 90 degrees clockwise, per tap. Bottom right in landscape,
 * bottom left in portrait; fades on scroll like the other header buttons because
 * it carries .dashboard-config-link. Shown only when "Allow display rotation" is
 * on and the device does not rotate itself (specs/kiosk-display-rotation.md).
 */
export function RotateDisplayButton() {
  const { allowed } = useDisplayRotation();
  if (!allowed) return null;

  return (
    <button
      type="button"
      className="dashboard-config-link dashboard-rotate-link"
      aria-label="Rotate display clockwise"
      data-demo-tooltip-title="Rotate"
      data-demo-tooltip="Rotate the display 90 degrees clockwise."
      onClick={() => {
        const rotate = (window as RotationBridge).novaKioskRotate;
        if (typeof rotate === "function") {
          rotate("clockwise");
        } else {
          console.warn("Display rotation is allowed here, but this machine has no rotation service.");
        }
      }}
    >
      <RotateCwSquare className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
