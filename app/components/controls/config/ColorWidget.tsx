"use client";

import { Clipboard, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";

/**
 * One colour slot on the configuration page: its dial, inline.
 *
 * Adeline, 2026-09-11: the controls must REPLACE the colour widget, not open in
 * a popup modal. There is no swatch card and no open/closed state — the dial's
 * ring is already the colour preview, so a card showing the same colour was
 * only a click in the way. Slot-specific extras (a toggle, a size or shared
 * opacity slider) render underneath the dial in the same cell.
 */
export function ColorWidget({
  children,
  label,
  onCopyColor,
  onPasteColor,
  pasteColorDisabled,
}: {
  children: ReactNode;
  label: string;
  onCopyColor?: () => void;
  onPasteColor?: () => void;
  pasteColorDisabled?: boolean;
}) {
  return (
    <div className="theme-widget-cell">
      {onCopyColor || onPasteColor ? (
        <div className="theme-widget-actions">
          {onCopyColor ? (
            <MomentaryFeedbackButton
              type="button"
              className="theme-widget-action"
              aria-label={`Copy ${label} colour`}
              data-demo-tooltip-title="Copy Colour"
              data-demo-tooltip="Copy this colour, intensity and opacity."
              onClick={onCopyColor}
            >
              <Copy className="h-4 w-4" />
            </MomentaryFeedbackButton>
          ) : null}
          {onPasteColor ? (
            <MomentaryFeedbackButton
              type="button"
              className="theme-widget-action"
              aria-label={`Paste colour into ${label}`}
              disabled={pasteColorDisabled}
              data-demo-tooltip-title="Paste Colour"
              data-demo-tooltip="Paste the copied colour into this widget."
              onClick={onPasteColor}
            >
              <Clipboard className="h-4 w-4" />
            </MomentaryFeedbackButton>
          ) : null}
        </div>
      ) : null}
      <div className="config-color-editor">{children}</div>
    </div>
  );
}
