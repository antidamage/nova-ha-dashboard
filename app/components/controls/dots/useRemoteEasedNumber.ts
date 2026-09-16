"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiteMode } from "../../dashboard/experienceModeSetting";
import { CONTROL_INTERACTION_COOLDOWN_MS } from "../../controlInteractionCooldown";
import { REMOTE_EASE_MS } from "./constants";
import { clamp, easeOut } from "./dot-model";

// Animates a 1D number toward target, snapping during local drag and easing on remote changes.
// In lite mode the easing rAF loop is skipped and remote changes snap directly.
// `snapRemote` opts a control out of the easing entirely: its value is always the
// exact target, never a frame part-way there. Used where the number shown must be
// the value that was set — see DotLineControl's `snapRemote` prop.
export function useRemoteEasedNumber(target: number, snapRemote = false) {
  const lite = useLiteMode() || snapRemote;
  const [displayValue, setDisplayValue] = useState(target);
  const [releaseRevision, setReleaseRevision] = useState(0);
  const displayValueRef = useRef(target);
  const latestTargetRef = useRef(target);
  const localInteractionRef = useRef(false);
  const remoteHoldUntilRef = useRef(0);
  const releaseTimerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  latestTargetRef.current = target;

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const setImmediate = useCallback(
    (next: number) => {
      cancelAnimation();
      displayValueRef.current = next;
      setDisplayValue(next);
    },
    [cancelAnimation],
  );

  const setLocalValue = useCallback(
    (next: number) => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      localInteractionRef.current = true;
      remoteHoldUntilRef.current = Number.POSITIVE_INFINITY;
      setImmediate(next);
    },
    [setImmediate],
  );

  const releaseLocalValue = useCallback(
    (next: number) => {
      setImmediate(next);
      localInteractionRef.current = false;
      remoteHoldUntilRef.current = Date.now() + CONTROL_INTERACTION_COOLDOWN_MS;
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = window.setTimeout(() => {
        releaseTimerRef.current = null;
        setReleaseRevision((current) => current + 1);
      }, CONTROL_INTERACTION_COOLDOWN_MS);
    },
    [setImmediate],
  );

  useEffect(() => {
    // Incoming state is never allowed to move a slider during a gesture or the
    // six-second release cooldown. The latest target is reconciled afterwards.
    if (localInteractionRef.current || Date.now() < remoteHoldUntilRef.current) {
      return;
    }

    cancelAnimation();
    const start = displayValueRef.current;
    const nextTarget = latestTargetRef.current;
    if (lite || Math.abs(nextTarget - start) < 0.01) {
      displayValueRef.current = nextTarget;
      setDisplayValue(nextTarget);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = clamp((now - startedAt) / REMOTE_EASE_MS, 0, 1);
      const next = start + (nextTarget - start) * easeOut(progress);
      displayValueRef.current = next;
      setDisplayValue(next);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
        displayValueRef.current = nextTarget;
        setDisplayValue(nextTarget);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [cancelAnimation, lite, releaseRevision, target]);

  useEffect(() => () => {
    cancelAnimation();
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
  }, [cancelAnimation]);

  return { displayValue, releaseLocalValue, releaseRevision, setLocalValue };
}
