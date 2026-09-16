"use client";

import { Check } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";

// The config pages' standard checkbox. Lifted here from AccentConfig once it
// grew a third consumer (AccentConfig's "This Device" block,
// VoiceInputDeviceGroup, RemindersConfig) — it had already been copy-pasted
// once, and a fourth divergent copy is how a checkbox stops looking like a
// checkbox.
export function CheckboxRow({
  checked,
  detail,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  /** Optional: most rows are a label and nothing else. */
  detail?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      className={`cyber-checkbox-row border p-4 text-left ${checked ? "cyber-checkbox-row-active" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true">
        {checked && <Check className="h-6 w-6" strokeWidth={3} />}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="theme-display-label zone-title-bar">{label}</span>
        {detail ? <span className="theme-display-detail">{detail}</span> : null}
      </span>
    </MomentaryFeedbackButton>
  );
}
