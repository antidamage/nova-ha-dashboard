"use client";

import { CircleHelp } from "lucide-react";
import { openTutorial } from "./tutorialStore";

/**
 * The "?" in the corner chrome that opens the tour (specs/tutorial-mode.md).
 * The cog's box and treatment, beside it; fixed-position, so it reflows
 * nothing.
 */
export function TutorialButton() {
  return (
    <button
      type="button"
      className="dashboard-config-link tutorial-help-button"
      aria-label="Tour the controls"
      data-demo-tooltip-title="Tour"
      data-demo-tooltip="Watch how each control works."
      onClick={openTutorial}
    >
      <CircleHelp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
