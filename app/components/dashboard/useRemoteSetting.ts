"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Default quiet period a non-matching remote value must hold before it is believed. */
export const REMOTE_SETTING_SETTLE_MS = 4000;
/** Default floor on how long a locally set value is held regardless of settling. */
export const REMOTE_SETTING_MIN_HOLD_MS = 12000;

/**
 * Local-versus-remote arbitration for a control whose device takes time to obey.
 *
 * Two behaviours, chosen by whether `isConverged` is supplied:
 *
 * - **Timed hold** (no `isConverged`): the local value wins for `timeoutMs`,
 *   then the remote value takes over unconditionally.
 * - **Latch** (`isConverged` supplied): the local value wins until the remote
 *   value *agrees* with it. Lights fade toward a commanded brightness, and a
 *   zone's reported brightness is an average across fixtures that fade at
 *   different rates, so remote values arriving mid-fade are interpolation
 *   artefacts — never something to display. The latch shows the value that was
 *   entered and ignores those, while still adopting a genuine change made
 *   elsewhere (Home Assistant, voice, a wall switch): such a change *settles*,
 *   holding one value for `settleMs`, whereas a fade keeps moving.
 */
export function useRemoteSetting<T>({
  isConverged,
  isEqual = Object.is,
  key,
  minHoldMs = REMOTE_SETTING_MIN_HOLD_MS,
  onRemoteAccept,
  remoteValue,
  settleMs = REMOTE_SETTING_SETTLE_MS,
  timeoutMs = 0,
}: {
  /**
   * Whether a remote value counts as having reached the local one. Supplying
   * this selects latch behaviour; it should be tolerant enough to absorb device
   * rounding, so a fixture settling a percent off still counts as arrived.
   */
  isConverged?: (remote: T, local: T) => boolean;
  isEqual?: (left: T, right: T) => boolean;
  key: string;
  minHoldMs?: number;
  onRemoteAccept?: (value: T) => void;
  remoteValue: T;
  settleMs?: number;
  timeoutMs?: number;
}) {
  const [value, setValue] = useState(remoteValue);
  const holdUntilRef = useRef(0);
  const keyRef = useRef(key);
  const remoteValueRef = useRef(remoteValue);
  const timerRef = useRef<number | null>(null);
  const valueRef = useRef(remoteValue);
  // Latch mode only: the value that was entered locally, when it was entered,
  // and the last non-matching remote value with the time it first appeared.
  const latchRef = useRef<{ target: T; at: number } | null>(null);
  const pendingRemoteRef = useRef<{ value: T; since: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyRemoteValue = useCallback(
    (next: T) => {
      latchRef.current = null;
      pendingRemoteRef.current = null;
      valueRef.current = next;
      setValue((current) => (isEqual(current, next) ? current : next));
      onRemoteAccept?.(next);
    },
    [isEqual, onRemoteAccept],
  );

  const scheduleRemoteResume = useCallback(() => {
    clearTimer();
    const remainingMs = holdUntilRef.current - Date.now();
    if (remainingMs <= 0) {
      applyRemoteValue(remoteValueRef.current);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (Date.now() >= holdUntilRef.current) {
        applyRemoteValue(remoteValueRef.current);
      } else {
        scheduleRemoteResume();
      }
    }, remainingMs);
  }, [applyRemoteValue, clearTimer]);

  /**
   * Believe the pending remote value once it has held still long enough — and
   * not before the minimum hold, which leaves room for the server's own
   * follow-up to drive a stalled fade the rest of the way to the target.
   */
  const scheduleLatchRelease = useCallback(() => {
    clearTimer();
    const latch = latchRef.current;
    const pending = pendingRemoteRef.current;
    if (!latch || !pending) {
      return;
    }

    const now = Date.now();
    const remainingMs = Math.max(pending.since + settleMs - now, latch.at + minHoldMs - now);
    if (remainingMs <= 0) {
      applyRemoteValue(remoteValueRef.current);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      scheduleLatchRelease();
    }, remainingMs);
  }, [applyRemoteValue, clearTimer, minHoldMs, settleMs]);

  const observeRemoteValue = useCallback(
    (next: T) => {
      const latch = latchRef.current;
      if (!latch || !isConverged) {
        applyRemoteValue(next);
        return;
      }

      if (isConverged(next, latch.target)) {
        // Arrived. Keep showing the entered value rather than the device's own
        // rounding of it, and stop counting toward an external change.
        pendingRemoteRef.current = null;
        clearTimer();
        return;
      }

      const pending = pendingRemoteRef.current;
      if (!pending || !isEqual(pending.value, next)) {
        pendingRemoteRef.current = { value: next, since: Date.now() };
      }
      scheduleLatchRelease();
    },
    [applyRemoteValue, clearTimer, isConverged, isEqual, scheduleLatchRelease],
  );

  useEffect(() => {
    remoteValueRef.current = remoteValue;

    if (keyRef.current !== key) {
      keyRef.current = key;
      holdUntilRef.current = 0;
      clearTimer();
      applyRemoteValue(remoteValue);
      return;
    }

    if (isConverged) {
      observeRemoteValue(remoteValue);
      return;
    }

    if (Date.now() < holdUntilRef.current) {
      scheduleRemoteResume();
      return;
    }

    applyRemoteValue(remoteValue);
  }, [applyRemoteValue, clearTimer, isConverged, key, observeRemoteValue, remoteValue, scheduleRemoteResume]);

  useEffect(() => clearTimer, [clearTimer]);

  const setLocalValue = useCallback(
    (next: T) => {
      if (isConverged) {
        latchRef.current = { target: next, at: Date.now() };
        pendingRemoteRef.current = null;
        clearTimer();
      } else {
        holdUntilRef.current = Date.now() + timeoutMs;
      }

      valueRef.current = next;
      setValue((current) => (isEqual(current, next) ? current : next));

      if (!isConverged) {
        scheduleRemoteResume();
      }
    },
    [clearTimer, isConverged, isEqual, scheduleRemoteResume, timeoutMs],
  );

  return { setLocalValue, value };
}
