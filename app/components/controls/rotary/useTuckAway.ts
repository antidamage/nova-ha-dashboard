"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { selectionHaptic } from "../../haptics";
import { RING_LIMIT, TUCK_RING_MS, TUCK_RING_STAGGER_MS } from "./constants";
import { now } from "./encoder-model";
import type { RotaryEncoderRing } from "./types";

/**
 * RotaryEncoder's tuck-away (specs/color-encoder.md, "Tuck-away"): the lock, the
 * idle timer, the tap-elsewhere relock, and the ring layer's mount timing.
 */
export function useTuckAway({
  tuckAfterMs,
  onLockChange,
  rings,
  pressed,
  rootRef,
}: {
  tuckAfterMs?: number;
  onLockChange?: (locked: boolean) => void;
  rings: RotaryEncoderRing[];
  pressed: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  // ── Tuck-away ─────────────────────────────────────────────────────────────

  const tuckable = typeof tuckAfterMs === "number";
  const [locked, setLocked] = useState(tuckable);
  const [showRings, setShowRings] = useState(!tuckable);
  const [lastInput, setLastInput] = useState(0);
  const noteInput = useCallback(() => setLastInput(now()), []);

  useEffect(() => {
    if (!tuckable) return;
    onLockChange?.(locked);
  }, [locked, onLockChange, tuckable]);

  // Rings stay mounted through the collapse so it can be watched; they only
  // leave the tree once the outermost has finished.
  const ringCount = Math.min(rings.length, RING_LIMIT);
  const collapseMs = TUCK_RING_MS + Math.max(0, ringCount - 1) * TUCK_RING_STAGGER_MS;
  // A ring layer that has fully left the tree remounts with its target style
  // already applied, so there is nothing for the CSS transition to animate
  // from — it would pop straight in. `entering` holds it at the tucked style
  // for one frame after remount, so the very next frame's flip to the open
  // style is a real transition, not a jump.
  const [entering, setEntering] = useState(false);
  const wasShowingRingsRef = useRef(showRings);
  useEffect(() => {
    if (!tuckable) return;
    if (!locked) {
      if (!wasShowingRingsRef.current) setEntering(true);
      wasShowingRingsRef.current = true;
      setShowRings(true);
      return;
    }
    wasShowingRingsRef.current = false;
    const timer = window.setTimeout(() => setShowRings(false), collapseMs);
    return () => window.clearTimeout(timer);
  }, [collapseMs, locked, tuckable]);

  // Two frames, not one: a single rAF callback still runs before the browser
  // has painted the tucked style, so the two style values coalesce and nothing
  // animates. The second frame guarantees the start state was painted.
  useEffect(() => {
    if (!entering) return;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [entering]);

  const relock = useCallback(() => {
    setLocked(true);
    selectionHaptic("lockDial");
  }, []);

  // Locks itself after a quiet spell. A pointer held down is not quiet.
  useEffect(() => {
    if (!tuckable || locked || pressed) return;
    const timer = window.setTimeout(relock, tuckAfterMs);
    return () => window.clearTimeout(timer);
  }, [lastInput, locked, pressed, relock, tuckAfterMs, tuckable]);

  // A tap anywhere else locks it at once, and still reaches what it landed on.
  const ringLayerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tuckable || locked) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || ringLayerRef.current?.contains(target)) return;
      relock();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [locked, relock, tuckable]);

  const unlock = () => {
    setLocked(false);
    noteInput();
    selectionHaptic("unlockDial");
  };

  return { tuckable, locked, setLocked, showRings, noteInput, entering, ringLayerRef, unlock };
}
