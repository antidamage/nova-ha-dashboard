"use client";

import { RotateCwSquare } from "lucide-react";
import { useCallback, useState } from "react";
import { useDisplayRotation } from "./dashboard/displayRotationSetting";
import { RotateDisplayModal } from "./RotateDisplayModal";

/**
 * The corner button that opens the rotate modal. Bottom right in landscape,
 * bottom left in portrait; fades on scroll like the other header buttons because
 * it carries .dashboard-config-link. Shown only when "Allow display rotation" is
 * on and the device does not rotate itself (specs/kiosk-display-rotation.md). It
 * does not rotate anything itself: the icon in the modal does.
 */
export function RotateDisplayButton() {
  const { allowed } = useDisplayRotation();
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  if (!allowed) return null;

  return (
    <>
      <button
        type="button"
        className="dashboard-config-link dashboard-rotate-link"
        aria-label="Rotate display"
        data-demo-tooltip-title="Rotate"
        data-demo-tooltip="Open the display rotation control."
        onClick={() => setOpen(true)}
      >
        <RotateCwSquare className="h-5 w-5" aria-hidden="true" />
      </button>
      {open ? <RotateDisplayModal onDismiss={dismiss} /> : null}
    </>
  );
}
