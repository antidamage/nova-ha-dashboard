"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useRemoteSetting<T>({
  isEqual = Object.is,
  key,
  onRemoteAccept,
  remoteValue,
  timeoutMs,
}: {
  isEqual?: (left: T, right: T) => boolean;
  key: string;
  onRemoteAccept?: (value: T) => void;
  remoteValue: T;
  timeoutMs: number;
}) {
  const [value, setValue] = useState(remoteValue);
  const holdUntilRef = useRef(0);
  const keyRef = useRef(key);
  const remoteValueRef = useRef(remoteValue);
  const timerRef = useRef<number | null>(null);
  const valueRef = useRef(remoteValue);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const applyRemoteValue = useCallback(
    (next: T) => {
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

  useEffect(() => {
    remoteValueRef.current = remoteValue;

    if (keyRef.current !== key) {
      keyRef.current = key;
      holdUntilRef.current = 0;
      clearTimer();
      applyRemoteValue(remoteValue);
      return;
    }

    if (Date.now() < holdUntilRef.current) {
      scheduleRemoteResume();
      return;
    }

    applyRemoteValue(remoteValue);
  }, [applyRemoteValue, clearTimer, key, remoteValue, scheduleRemoteResume]);

  useEffect(() => clearTimer, [clearTimer]);

  const setLocalValue = useCallback(
    (next: T) => {
      holdUntilRef.current = Date.now() + timeoutMs;
      valueRef.current = next;
      setValue((current) => (isEqual(current, next) ? current : next));
      scheduleRemoteResume();
    },
    [isEqual, scheduleRemoteResume, timeoutMs],
  );

  return { setLocalValue, value };
}
