"use client";

import { Loader2 } from "lucide-react";
import { createPortal } from "react-dom";

// Double-confirm modal for the destructive re-init (like System Power).
export function ReinitConfirmDialog({
  agentName,
  closeConfirm,
  confirmStage,
  onConfirm,
  reinitBusy,
}: {
  agentName: string;
  closeConfirm: () => void;
  confirmStage: 0 | 1 | 2;
  onConfirm: () => void;
  reinitBusy: boolean;
}) {
  return (
    <>
    {confirmStage !== 0 && typeof document !== "undefined"
      ? createPortal(
          <div className="system-confirm-overlay" role="presentation" onClick={closeConfirm}>
            <div
              className="system-confirm-card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="camera-reinit-title"
              aria-describedby="camera-reinit-body"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="system-stripe system-stripe-top" aria-hidden="true" />
              <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
              <p className="system-confirm-step">
                {confirmStage === 1 ? "Confirmation 1 of 2" : "Confirmation 2 of 2 — last chance"}
              </p>
              <h3 id="camera-reinit-title" className="system-confirm-title">
                {confirmStage === 1 ? "Re-initialise the Outside camera?" : "Final confirmation"}
              </h3>
              <p id="camera-reinit-body" className="system-confirm-body">
                {confirmStage === 1
                  ? "This restarts the camera recorder and performs a full USB re-initialisation of the capture device (free it, reset it, re-enumerate it). The live feed and DVR scrub-back window will drop for up to a minute while it comes back. The dashboard, Home Assistant and everything else stay running."
                  : `This is your last chance to stop. The Outside camera feed will go down and rebuild; the last couple of hours of DVR scrub-back will reset. Nothing else on ${agentName} is affected.`}
              </p>
              <div className="system-confirm-actions">
                <button type="button" className="system-confirm-cancel" disabled={reinitBusy} onClick={closeConfirm}>
                  Cancel
                </button>
                <button type="button" className="system-confirm-go" disabled={reinitBusy} onClick={onConfirm}>
                  {reinitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {confirmStage === 1 ? "Yes, re-initialise the camera" : "Re-initialise the camera now"}
                </button>
              </div>
              <p className="system-confirm-dismiss-hint">Tap anywhere outside this box to cancel.</p>
            </div>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
