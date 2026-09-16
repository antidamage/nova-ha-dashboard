"use client";

// The Quick Access tile parts every segment builds on: the segment group, the
// bare climate wrapper, the title/state pair, and the momentary button.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { classNames } from "../shared";

export function QuickSegment({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={classNames("quick-segment", className)} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * A climate knob, and no tile around it. The knob's dial is 124px across where a
 * tile's row is 84px, so boxing one made it overflow its own border and collide
 * with the tile below in the landscape grid. The two climate knobs sit inline in
 * `quick-climate-row` instead (Adeline, 2026-09-12).
 *
 * The written name above each knob is gone: the knob carries its own title arc
 * now (Adeline, 2026-09-12, specs/color-encoder.md). The group's aria-label
 * still names it for assistive tech.
 */
export function QuickClimate({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="quick-climate quick-segment-climate" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function SegmentTitle({ state, title }: { state: string; title: string }) {
  return (
    <div className="quick-segment-text">
      <span className="quick-segment-title">{title}</span>
      <span className="quick-segment-state">{state}</span>
    </div>
  );
}

export function QuickButton({
  active,
  disabled,
  icon: Icon,
  iconOnly = false,
  label,
  onClick,
  pressed,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  /**
   * Drops the written label and squares the button up, the icon carrying it
   * alone. `label` still goes to `aria-label`, so nothing is lost to assistive
   * tech — only to the eye (Adeline, 2026-09-12, the lighting presets).
   */
  iconOnly?: boolean;
  label: string;
  onClick: () => void;
  /** Set for toggle-like choices (Auto/Off) so assistive tech reads the selection. */
  pressed?: boolean;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={classNames(
        "quick-button border",
        iconOnly && "quick-button-icon",
        active && "quick-button-active",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={iconOnly ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
      {iconOnly ? null : <span>{label}</span>}
    </MomentaryFeedbackButton>
  );
}
