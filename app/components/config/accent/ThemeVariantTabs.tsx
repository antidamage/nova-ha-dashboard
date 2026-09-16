"use client";

import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { THEME_VARIANTS } from "../../accentColor";
import type { ThemeVariant } from "../../theme/accent/types";
import { THEME_VARIANT_LABELS } from "./accent-config-model";

export function ThemeVariantTabs({
  onChange,
  value,
}: {
  onChange: (value: ThemeVariant) => void;
  value: ThemeVariant;
}) {
  return (
    <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Theme editor">
      {THEME_VARIANTS.map((variant) => {
        const active = value === variant;

        return (
          <MomentaryFeedbackButton
            key={variant}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? "true" : "false"}
            className={`theme-choice-tab border p-4 text-left ${active ? "theme-choice-tab-active" : ""}`}
            onClick={() => onChange(variant)}
          >
            <span className="grid min-w-0 gap-1">
              <span className="theme-display-label zone-title-bar">{THEME_VARIANT_LABELS[variant]}</span>
              <span className="theme-display-detail">Edit theme values</span>
            </span>
          </MomentaryFeedbackButton>
        );
      })}
    </div>
  );
}
