"use client";

import type { ReactNode } from "react";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

/**
 * Nova's one toggle. Every on/off setting on the surface — dashboard and
 * config — is this switch; a checkbox now only turns on a group of settings.
 * See specs/slide-switch.md.
 *
 * The track fill and the thumb's position carry the state. The Off/On labels
 * beside the track never change colour, so they stay legible whatever the
 * theme does with the highlight.
 */
export function SlideSwitch({
  checked,
  disabled,
  icon,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Optional glyph carried inside the thumb. */
  icon?: ReactNode;
  /** Accessible name; the visible labels are the track's Off/On. */
  label: string;
  onChange: () => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      className={`cyber-switch${checked ? " cyber-switch-checked" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="cyber-switch-thumb">{icon}</span>
    </MomentaryFeedbackButton>
  );
}

/** The switch with its static Off/On labels either side. */
export function LabeledSlideSwitch({
  checked,
  disabled,
  icon,
  label,
  leftLabel = "Off",
  onChange,
  rightLabel = "On",
}: {
  checked: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  leftLabel?: string;
  onChange: () => void;
  rightLabel?: string;
}) {
  return (
    <div className={`climate-switch-row border${disabled ? " climate-switch-row-disabled" : ""}`}>
      <span className="climate-switch-label">{leftLabel}</span>
      <SlideSwitch checked={checked} disabled={disabled} icon={icon} label={label} onChange={onChange} />
      <span className="climate-switch-label">{rightLabel}</span>
    </div>
  );
}

/**
 * A config row that is a single setting: title, optional detail, and the
 * switch at the trailing edge. Replaces the checkbox rows that were toggling
 * one thing rather than opening a group.
 */
export function SwitchRow({
  checked,
  detail,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  detail?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={`cyber-switch-row border p-4 text-left${checked ? " cyber-switch-row-active" : ""}${
        disabled ? " cursor-not-allowed opacity-50" : ""
      }`}
    >
      <span className="grid min-w-0 gap-1">
        <span className="theme-display-label zone-title-bar">{label}</span>
        {detail ? <span className="theme-display-detail">{detail}</span> : null}
      </span>
      <SlideSwitch
        checked={checked}
        disabled={disabled}
        label={label}
        onChange={() => {
          if (disabled) return;
          onChange(!checked);
        }}
      />
    </div>
  );
}
