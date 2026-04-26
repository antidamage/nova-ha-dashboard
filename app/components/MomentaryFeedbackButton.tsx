"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
} from "react";

const MOMENTARY_FEEDBACK_HOLD_MS = 500;
const MOMENTARY_DEFOCUS_DELAY_MS = 1000;
const MOMENTARY_FEEDBACK_CLASS = "momentary-feedback";
const MOMENTARY_FEEDBACK_ACTIVE_CLASS = "momentary-feedback-active";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function useMomentaryFeedback() {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearFeedbackTimeout = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }

    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const showFeedback = useCallback(() => {
    clearFeedbackTimeout();
    setActive(true);
  }, [clearFeedbackTimeout]);

  const releaseFeedback = useCallback(() => {
    clearFeedbackTimeout();
    timeoutRef.current = window.setTimeout(() => {
      setActive(false);
      timeoutRef.current = null;
    }, MOMENTARY_FEEDBACK_HOLD_MS);
  }, [clearFeedbackTimeout]);

  const triggerFeedback = useCallback(() => {
    showFeedback();
    releaseFeedback();
  }, [releaseFeedback, showFeedback]);

  useEffect(() => clearFeedbackTimeout, [clearFeedbackTimeout]);

  return { active, releaseFeedback, showFeedback, triggerFeedback };
}

export function MomentaryFeedbackButton({
  className,
  disabled,
  onClick,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { active, releaseFeedback, showFeedback, triggerFeedback } = useMomentaryFeedback();
  const touchPointerActive = useRef(false);
  const defocusTimeoutRef = useRef<number | null>(null);

  const clearDefocusTimeout = useCallback(() => {
    if (defocusTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(defocusTimeoutRef.current);
    defocusTimeoutRef.current = null;
  }, []);

  const scheduleDefocus = useCallback(
    (button: HTMLButtonElement) => {
      clearDefocusTimeout();
      defocusTimeoutRef.current = window.setTimeout(() => {
        button.blur();
        defocusTimeoutRef.current = null;
      }, MOMENTARY_DEFOCUS_DELAY_MS);
    },
    [clearDefocusTimeout],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!disabled && event.pointerType !== "mouse") {
        touchPointerActive.current = true;
        showFeedback();
      }

      onPointerDown?.(event);
    },
    [disabled, onPointerDown, showFeedback],
  );

  const handlePointerRelease = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (touchPointerActive.current) {
        touchPointerActive.current = false;
        scheduleDefocus(event.currentTarget);
        releaseFeedback();
      }

      if (event.type === "pointercancel") {
        onPointerCancel?.(event);
        return;
      }

      onPointerUp?.(event);
    },
    [onPointerCancel, onPointerUp, releaseFeedback, scheduleDefocus],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!disabled) {
        scheduleDefocus(event.currentTarget);
        triggerFeedback();
      }

      onClick?.(event);
    },
    [disabled, onClick, scheduleDefocus, triggerFeedback],
  );

  useEffect(() => clearDefocusTimeout, [clearDefocusTimeout]);

  return (
    <button
      {...props}
      disabled={disabled}
      onClick={handleClick}
      onPointerCancel={handlePointerRelease}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerRelease}
      className={classNames(
        MOMENTARY_FEEDBACK_CLASS,
        className,
        active && MOMENTARY_FEEDBACK_ACTIVE_CLASS,
      )}
    />
  );
}
