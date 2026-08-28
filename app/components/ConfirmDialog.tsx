"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { ModalOverlay } from "./ModalOverlay";

/**
 * The dashboard's confirmation dialog: one or two stages of "are you sure",
 * rendered on the shared `ModalOverlay` so it gets the focus trap, the inert
 * background, Escape and tap-outside-to-cancel for free.
 *
 * This was two near-identical hand-rolled implementations — the two-stage one in
 * `SystemControlConfig` and the one-stage one in `DesktopSleepPanel`, which had
 * its own portal and its own Escape handler. Both now come through here, and so
 * does the module system's confirm interceptor (`specs/module-system.md` §3.2),
 * which is why this exists as a component rather than a third copy.
 */
export type ConfirmStage = {
  title: string;
  body: string;
  confirmLabel: string;
  /** Replaces the default "Confirmation N of M" line above the title. */
  step?: string;
};

export type ConfirmCopy = {
  /** One stage for a plain confirm; two for "last chance" flows. */
  stages: ConfirmStage[];
  cancelLabel?: string;
  /** Pass null to drop the "tap outside to cancel" line. */
  dismissHint?: string | null;
};

function defaultStep(index: number, total: number) {
  if (total < 2) {
    return null;
  }
  const base = `Confirmation ${index + 1} of ${total}`;
  return index === total - 1 ? `${base} — last chance` : base;
}

export function ConfirmDialog({
  busy = false,
  copy,
  onCancel,
  onConfirm,
  open,
}: {
  /** Disables both buttons and spins the confirm button. */
  busy?: boolean;
  copy: ConfirmCopy | null;
  onCancel: () => void;
  /** Called once, after the final stage is confirmed. */
  onConfirm: () => void;
  open: boolean;
}) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;
  const [stageIndex, setStageIndex] = useState(0);

  // A reopened dialog always starts at the first stage — otherwise a second
  // invocation would inherit the previous one's progress and skip a warning.
  useEffect(() => {
    if (!open) {
      setStageIndex(0);
    }
  }, [open]);

  const close = useCallback(() => {
    if (busy) {
      return;
    }
    onCancel();
  }, [busy, onCancel]);

  const stages = copy?.stages ?? [];
  const stage = stages[Math.min(stageIndex, Math.max(stages.length - 1, 0))];

  const advance = useCallback(() => {
    if (stageIndex < stages.length - 1) {
      setStageIndex(stageIndex + 1);
      return;
    }
    onConfirm();
  }, [onConfirm, stageIndex, stages.length]);

  const step = stage?.step ?? defaultStep(stageIndex, stages.length);
  const dismissHint =
    copy?.dismissHint === undefined ? "Tap anywhere outside this box to cancel." : copy.dismissHint;

  return (
    <ModalOverlay
      open={Boolean(open && stage)}
      onClose={close}
      dialogRole="alertdialog"
      ariaLabelledBy={titleId}
      ariaDescribedBy={bodyId}
      className="system-confirm-card"
    >
      {stage ? (
        <>
          <span className="system-stripe system-stripe-top" aria-hidden="true" />
          <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
          {step ? <p className="system-confirm-step">{step}</p> : null}
          <h3 id={titleId} className="system-confirm-title">
            {stage.title}
          </h3>
          <p id={bodyId} className="system-confirm-body">
            {stage.body}
          </p>
          <div className="system-confirm-actions">
            <button type="button" className="system-confirm-cancel" disabled={busy} onClick={close}>
              {copy?.cancelLabel ?? "Cancel"}
            </button>
            <button type="button" className="system-confirm-go" disabled={busy} onClick={advance}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {stage.confirmLabel}
            </button>
          </div>
          {dismissHint ? <p className="system-confirm-dismiss-hint">{dismissHint}</p> : null}
        </>
      ) : null}
    </ModalOverlay>
  );
}
