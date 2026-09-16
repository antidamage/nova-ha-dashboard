"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiteMode } from "../../dashboard/experienceModeSetting";
import { REMOTE_EASE_MS } from "./constants";
import { clamp, easeOut } from "./dot-model";
import type { Cursor } from "./types";

// Animates a 2D cursor toward target, snapping during local drag and easing on remote changes.
// In lite mode the easing rAF loop is skipped and remote changes snap directly.
export function useEasedCursor(targetX: number, targetY: number) {
  const lite = useLiteMode();
  const [display, setDisplay] = useState<Cursor>({ x: targetX, y: targetY });
  const displayRef = useRef<Cursor>({ x: targetX, y: targetY });
  const localRef = useRef(false);
  const animRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  const setLocal = useCallback(
    (next: Cursor) => {
      cancel();
      localRef.current = true;
      displayRef.current = next;
      setDisplay(next);
    },
    [cancel],
  );

  const release = useCallback(
    (next: Cursor) => {
      cancel();
      displayRef.current = next;
      setDisplay(next);
      localRef.current = false;
    },
    [cancel],
  );

  useEffect(() => {
    if (localRef.current) {
      const next = { x: targetX, y: targetY };
      displayRef.current = next;
      setDisplay(next);
      return;
    }

    cancel();
    const start = displayRef.current;
    const dist = Math.hypot(targetX - start.x, targetY - start.y);
    if (lite || dist < 0.001) {
      const next = { x: targetX, y: targetY };
      displayRef.current = next;
      setDisplay(next);
      return;
    }

    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = clamp((now - startedAt) / REMOTE_EASE_MS, 0, 1);
      const e = easeOut(t);
      const next = { x: start.x + (targetX - start.x) * e, y: start.y + (targetY - start.y) * e };
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        displayRef.current = { x: targetX, y: targetY };
        setDisplay({ x: targetX, y: targetY });
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [cancel, lite, targetX, targetY]);

  useEffect(() => cancel, [cancel]);

  return { display, setLocal, release };
}
