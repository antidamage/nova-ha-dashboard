"use client";

/**
 * The striped card. Same `.system-confirm-card` plus paired `.system-stripe`
 * spans that `ConfirmDialog`, `SystemBlocker` and the system-power buttons use,
 * so sign-in reads as the same class of thing as the other guarded actions.
 *
 * The stripes are child spans rather than pseudo-elements deliberately: the
 * dashboard shell applies an `::after` press flash to every
 * `MomentaryFeedbackButton` and they would collide.
 */
export function Shell({
  children,
  compact,
  onCancel,
  title,
}: {
  children: React.ReactNode;
  compact: boolean;
  onCancel?: () => void;
  title: string;
}) {
  return (
    <>
      <span className="system-stripe system-stripe-top" aria-hidden="true" />
      <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
      <div className={compact ? "grid gap-3 py-3" : "grid gap-4 py-4"}>
        <h2 className="system-confirm-title">{title}</h2>
        {children}
        {onCancel ? (
          <button type="button" className="system-confirm-cancel justify-self-start" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );
}
