"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useStageTimer, type StagePhase } from "./confirm-stage-timer";
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
  /**
   * Optional per-stage timing, applied to every stage: the confirm button is
   * locked for `armDelayMs` after the stage opens, then accepted for
   * `expireMs`, after which the dialog shows a timeout line and cancels itself.
   * Untimed when both are unset. See `confirm-stage-timer.ts`.
   */
  armDelayMs?: number;
  expireMs?: number;
};

// How long the timeout line stays up before the dialog cancels itself.
export const CONFIRM_EXPIRED_NOTICE_MS = 2_000;

const EXPIRED_MESSAGE = "Timed out. Nothing was sent.";

// Announced once per phase change, never per second: the visible countdown is
// aria-hidden so a screen reader does not read every tick.
function announcement(phase: StagePhase, armDelayMs = 0) {
  if (phase === "locked") {
    return `Confirm available in ${Math.round(armDelayMs / 1000)} seconds`;
  }
  return phase === "live" ? "Confirm now" : EXPIRED_MESSAGE;
}

function StageCountdown({
  fractionLeft,
  phase,
  secondsLeft,
}: {
  fractionLeft: number;
  phase: StagePhase;
  secondsLeft: number;
}) {
  if (phase !== "locked" && phase !== "live") {
    return null;
  }
  return (
    <div className="system-confirm-countdown" data-phase={phase} aria-hidden="true">
      <span className="system-confirm-countdown-text">
        {phase === "locked" ? `Available in ${secondsLeft}` : `${secondsLeft} s left`}
      </span>
      {phase === "live" ? (
        <span className="system-confirm-countdown-bar">
          <span style={{ transform: `scaleX(${fractionLeft})` }} />
        </span>
      ) : null}
    </div>
  );
}

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

  const timer = useStageTimer({
    armDelayMs: copy?.armDelayMs,
    expireMs: copy?.expireMs,
    running: Boolean(open && stage),
    stageKey: stageIndex,
  });
  const blocked = timer.phase === "locked" || timer.phase === "expired";

  // An unconfirmed stage cancels the whole flow once its notice has been seen.
  // Held in a ref so a parent re-render cannot restart the notice timer.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    if (timer.phase !== "expired") {
      return;
    }
    const timeout = setTimeout(() => onCancelRef.current(), CONFIRM_EXPIRED_NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [timer.phase]);

  const advance = useCallback(() => {
    if (blocked) {
      return;
    }
    if (stageIndex < stages.length - 1) {
      setStageIndex(stageIndex + 1);
      return;
    }
    onConfirm();
  }, [blocked, onConfirm, stageIndex, stages.length]);

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
            {timer.phase === "expired" ? EXPIRED_MESSAGE : stage.body}
          </p>
          <div className="system-confirm-actions">
            <button type="button" className="system-confirm-cancel" disabled={busy} onClick={close}>
              {copy?.cancelLabel ?? "Cancel"}
            </button>
            {timer.phase === "expired" ? null : (
              <button
                type="button"
                className="system-confirm-go"
                disabled={busy}
                aria-disabled={blocked || undefined}
                data-phase={timer.phase}
                onClick={advance}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {stage.confirmLabel}
              </button>
            )}
          </div>
          <StageCountdown phase={timer.phase} secondsLeft={timer.secondsLeft} fractionLeft={timer.fractionLeft} />
          {/* Always mounted, so a change of text is announced. */}
          <p className="sr-only" aria-live="polite">
            {timer.phase === "ready" ? "" : announcement(timer.phase, copy?.armDelayMs)}
          </p>
          {dismissHint ? <p className="system-confirm-dismiss-hint">{dismissHint}</p> : null}
        </>
      ) : null}
    </ModalOverlay>
  );
}
