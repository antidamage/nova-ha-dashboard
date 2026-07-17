"use client";

import { Loader2 } from "lucide-react";
import { createPortal } from "react-dom";

// Shared full-screen "Nova is unavailable" blocker: a 25%-black wash with a
// spinner card in the same construction-box scheme as the System Power popup.
// Portaled to <body> so the .zone-panel clip-path can't trap/clip it. Used both
// by the initiating /config device (SystemControlConfig) and the global
// OfflineBlocker that covers every other screen. Callers may opt into Dismiss
// (hide the blocker, keep the page usable) and Refresh (reload now) buttons;
// without them the card has no close affordance (restart/reboot flows).
export function SystemBlocker({
  title,
  body,
  onDismiss,
  onRefresh,
}: {
  title: string;
  body: string;
  /** When set, renders a Dismiss button that hides the blocker. */
  onDismiss?: () => void;
  /** When set, renders a Refresh button that reloads the page. */
  onRefresh?: () => void;
}) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      className="system-blocker-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={title}
    >
      <div className="system-blocker-card">
        <span className="system-stripe system-stripe-top" aria-hidden="true" />
        <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
        <Loader2 className="system-blocker-spinner h-12 w-12 animate-spin" aria-hidden="true" />
        <h3 className="system-blocker-title">{title}</h3>
        <p className="system-blocker-body">{body}</p>
        {onDismiss || onRefresh ? (
          <div className="system-blocker-actions">
            {onDismiss ? (
              <button type="button" className="system-confirm-cancel" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
            {onRefresh ? (
              <button type="button" className="system-confirm-go" onClick={onRefresh}>
                Refresh
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
