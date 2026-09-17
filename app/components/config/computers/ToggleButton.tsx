"use client";

import type { ReactNode } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";

export function ToggleButton({
  checked,
  children,
  disabled,
  onChange,
}: {
  checked: boolean;
  children: ReactNode;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`cyber-checkbox-row border p-3 text-left ${checked ? "cyber-checkbox-row-active" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true" />
      <span className="theme-display-label zone-title-bar">{children}</span>
    </MomentaryFeedbackButton>
  );
}
