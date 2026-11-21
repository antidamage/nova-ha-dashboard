"use client";

import { CircleHelp } from "lucide-react";
import { openTutorial, useQuickStart } from "./tutorialStore";

/**
 * The "?" in the corner chrome that opens the tour (specs/tutorial-mode.md).
 * The cog's box and treatment, beside it; fixed-position, so it reflows
 * nothing.
 */
export function TutorialButton() {
  // Just after the experience chooser, the "?" extends with a label.
  const quickStart = useQuickStart();
  return (
    <button
      type="button"
      className="dashboard-config-link tutorial-help-button"
      data-quick-start={quickStart ? "true" : undefined}
      aria-label={quickStart ? "Quick-start tutorial" : "Tour the controls"}
      data-demo-tooltip-title="Tour"
      data-demo-tooltip="Watch how each control works."
      onClick={openTutorial}
    >
      <CircleHelp className="h-5 w-5" aria-hidden="true" />
      {quickStart ? <span className="tutorial-quick-start-label">Quick-start tutorial</span> : null}
    </button>
  );
}
