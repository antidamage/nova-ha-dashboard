"use client";

import { useEffect, useRef } from "react";
import type { TargetRange } from "../../temperatureEncoderModel";

/**
 * Clamp and send: a target outside the knob's range is pulled to the nearest
 * edge and sent once for that target and range (specs/temperature-encoder.md).
 */
export function useClampTargetIntoRange(
  target: number | null | undefined,
  range: TargetRange,
  disabled: boolean,
  send: (next: number) => void,
) {
  const sentFor = useRef<string | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (disabled || typeof target !== "number" || !Number.isFinite(target)) return;
    const clamped = Math.max(range.min, Math.min(range.max, target));
    if (clamped === target) {
      sentFor.current = null;
      return;
    }
    const key = `${target}:${range.min}:${range.max}`;
    if (sentFor.current === key) return;
    sentFor.current = key;
    sendRef.current(clamped);
  }, [disabled, range.min, range.max, target]);
}
