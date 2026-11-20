"use client";

import { X } from "lucide-react";
import { forwardRef, type CSSProperties } from "react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import type { Placement } from "./geometry-model";
import type { TutorialStep } from "./steps";

type PanelProps = {
  step: TutorialStep;
  placement: Placement;
  width: number;
  flash: boolean;
  showReplay: boolean;
  offscreen: boolean;
  onClose: () => void;
  onReplay: () => void;
  onBackToControl: () => void;
  /** Opens "How was this control built?"; absent where the step has none. */
  onLayers?: () => void;
};

/**
 * The caption panel (specs/tutorial-mode.md, "The caption panel and bottom
 * bar"): the step title, its caption as a polite live region, the close box,
 * and Replay / Back to the control when they apply.
 */
export const TutorialPanel = forwardRef<HTMLDivElement, PanelProps>(function TutorialPanel(
  { step, placement, width, flash, showReplay, offscreen, onClose, onReplay, onBackToControl, onLayers },
  ref,
) {
  const style = { transform: `translate3d(${placement.left.toFixed(1)}px, ${placement.top.toFixed(1)}px, 0)`, width } as CSSProperties;
  return (
    <section
      ref={ref}
      className="tutorial-panel"
      data-tutorial-ui=""
      data-tutorial-panel=""
      data-side={placement.side}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-step-title"
      tabIndex={-1}
    >
      <MomentaryFeedbackButton
        className="tutorial-close"
        data-flash={flash ? "true" : undefined}
        aria-label="Close the tour"
        onClick={onClose}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </MomentaryFeedbackButton>
      <h2 id="tutorial-step-title" className="tutorial-title">{step.title}</h2>
      <p className="tutorial-caption" aria-live="polite">{step.caption}</p>
      {showReplay || offscreen || onLayers ? (
        <div className="tutorial-panel-actions">
          {offscreen ? (
            <MomentaryFeedbackButton className="tutorial-button" onClick={onBackToControl}>Back to the control</MomentaryFeedbackButton>
          ) : null}
          {showReplay ? (
            <MomentaryFeedbackButton className="tutorial-button" onClick={onReplay}>Replay</MomentaryFeedbackButton>
          ) : null}
          {onLayers ? (
            <MomentaryFeedbackButton className="tutorial-button tutorial-layers-button" onClick={onLayers}>How was this control built?</MomentaryFeedbackButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

type BarProps = {
  index: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
};

/** The fixed bottom bar: Back, the step count, Next (Done on the last step). */
export function TutorialBar({ index, count, onBack, onNext }: BarProps) {
  const last = index >= count - 1;
  return (
    <nav className="tutorial-bar" data-tutorial-ui="" data-tutorial-panel="" aria-label="Tour steps">
      <MomentaryFeedbackButton className="tutorial-button" onClick={onBack} disabled={index === 0}>
        Back
      </MomentaryFeedbackButton>
      <span className="tutorial-count" aria-live="polite">{`${index + 1} / ${count}`}</span>
      <MomentaryFeedbackButton className="tutorial-button tutorial-button-next" onClick={onNext}>
        {last ? "Done" : "Next"}
      </MomentaryFeedbackButton>
    </nav>
  );
}
