"use client";

import { Lock, LockOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

// A text field guarded by a lock. It is read-only until the lock icon is
// tapped; once unlocked it re-locks automatically when either:
//   - it leaves the viewport for more than OFFSCREEN_RELOCK_MS, or
//   - it goes UNINTERACTED_RELOCK_MS without any interaction.
// This keeps sensitive connection descriptors (the custom voice-input path)
// from being edited by accident on a shared/kiosk dashboard.

const OFFSCREEN_RELOCK_MS = 4000;
const UNINTERACTED_RELOCK_MS = 10000;

export function LockableField({
  value,
  onChange,
  label,
  detail,
  placeholder,
  inputId,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  detail?: string;
  placeholder?: string;
  inputId?: string;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const offscreenTimerRef = useRef<number | null>(null);

  const lock = useCallback(() => setUnlocked(false), []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  // (Re)start the 10s no-interaction timer. Called on unlock and on every
  // interaction while unlocked.
  const bumpIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(lock, UNINTERACTED_RELOCK_MS);
  }, [clearIdleTimer, lock]);

  // Idle re-lock + offscreen re-lock are only armed while unlocked. Locking
  // clears both. Focus the input on unlock so editing can start immediately.
  useEffect(() => {
    if (!unlocked) {
      clearIdleTimer();
      if (offscreenTimerRef.current !== null) {
        window.clearTimeout(offscreenTimerRef.current);
        offscreenTimerRef.current = null;
      }
      return;
    }

    bumpIdleTimer();
    inputRef.current?.focus();

    const container = containerRef.current;
    let observer: IntersectionObserver | null = null;
    if (container && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          if (entry.isIntersecting) {
            // Back on screen — cancel any pending offscreen re-lock.
            if (offscreenTimerRef.current !== null) {
              window.clearTimeout(offscreenTimerRef.current);
              offscreenTimerRef.current = null;
            }
          } else if (offscreenTimerRef.current === null) {
            offscreenTimerRef.current = window.setTimeout(lock, OFFSCREEN_RELOCK_MS);
          }
        },
        { threshold: 0.01 },
      );
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
    };
  }, [unlocked, bumpIdleTimer, clearIdleTimer, lock]);

  // Any interaction while unlocked resets the idle timer.
  const onInteract = useCallback(() => {
    if (unlocked) {
      bumpIdleTimer();
    }
  }, [unlocked, bumpIdleTimer]);

  return (
    <div
      className="lockable-field grid gap-1"
      ref={containerRef}
      onPointerDown={onInteract}
      onKeyDown={onInteract}
    >
      {label ? (
        <label htmlFor={inputId} className="theme-display-label zone-title-bar">
          {label}
        </label>
      ) : null}
      <div className="lockable-field-row flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="cyber-text-input flex-1"
          value={value}
          placeholder={placeholder}
          readOnly={!unlocked}
          aria-readonly={!unlocked}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            onInteract();
            onChange(event.target.value);
          }}
          onBlur={onInteract}
        />
        <MomentaryFeedbackButton
          type="button"
          className={`lockable-field-lock border p-3 ${unlocked ? "lockable-field-lock-open" : ""}`}
          aria-label={unlocked ? `Lock ${label}` : `Unlock ${label} to edit`}
          aria-pressed={unlocked}
          onClick={() => setUnlocked((current) => !current)}
        >
          {unlocked ? (
            <LockOpen className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Lock className="h-5 w-5" aria-hidden="true" />
          )}
        </MomentaryFeedbackButton>
      </div>
      {detail ? <p className="theme-display-detail">{detail}</p> : null}
    </div>
  );
}

export default LockableField;
