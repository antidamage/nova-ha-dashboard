"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWideDashboard } from "./HorizontalAccordion";

/**
 * A panel's default view, a sunken "Advanced" line at the bottom of it, and
 * the detail hidden past that line. See specs/advanced-fold.md.
 *
 * Closed, the region holding the advanced content is not in the layout at all,
 * so the panel has nothing to scroll: travel toward the line is caught here,
 * resisted, and only past the snap does the region appear and ordinary
 * scrolling take over. Coming back to the very start closes it again, which is
 * free — the resistance is one-directional.
 *
 * Landscape folds downward, portrait sideways to the right (the advanced
 * content is laid out as full-width cells there, hence the grid).
 */

/** Input travel needed to break the fold open. */
export const ADVANCED_FOLD_SNAP_PX = 40;
/** How much of that travel the content actually moves while resisting. */
export const ADVANCED_FOLD_RESISTANCE = 1 / 3;
/** A wheel that stops for this long has given up; the pull decays. */
const PULL_IDLE_MS = 400;

export function AdvancedFold({
  advanced,
  children,
  className = "",
}: {
  /** What sits below (landscape) or right of (portrait) the line. */
  advanced: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const wide = useWideDashboard();
  const axis: "y" | "x" = wide ? "y" : "x";
  const [open, setOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pullRef = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  // A fold is closed on every load and on every layout flip; nothing about it
  // is persisted (specs/advanced-fold.md).
  useEffect(() => {
    setOpen(false);
    setPull(0);
    pullRef.current = 0;
  }, [axis]);

  const setPullValue = useCallback((next: number) => {
    pullRef.current = next;
    setPull(next);
  }, []);

  const release = useCallback(() => {
    dragFrom.current = null;
    if (pullRef.current > 0) setPullValue(0);
  }, [setPullValue]);

  /** Travel toward the advanced side, in input pixels. Returns true if it was consumed. */
  const pullBy = useCallback(
    (amount: number) => {
      if (open) return false;
      if (amount <= 0) {
        if (pullRef.current > 0) setPullValue(0);
        return false;
      }
      const next = pullRef.current + amount;
      if (next >= ADVANCED_FOLD_SNAP_PX) {
        setPullValue(0);
        setOpen(true);
        return true;
      }
      setPullValue(next);
      return true;
    },
    [open, setPullValue],
  );

  // Wheel: the same 40px, accumulated, decaying when the wheel stops.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || open) return;

    const onWheel = (event: WheelEvent) => {
      const travel = axis === "y" ? event.deltaY : event.deltaX || event.deltaY;
      if (travel <= 0) return;
      if (pullBy(travel)) event.preventDefault();
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setPullValue(0), PULL_IDLE_MS);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [axis, open, pullBy, setPullValue]);

  // Touch: non-passive, or the browser scrolls the column out from under the
  // resistance before we see the move.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || open) return;

    let start: { x: number; y: number } | null = null;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const travel = axis === "y" ? start.y - touch.clientY : start.x - touch.clientX;
      start = { x: touch.clientX, y: touch.clientY };
      if (pullBy(travel)) event.preventDefault();
    };
    const onEnd = () => {
      start = null;
      release();
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd, { passive: true });
    node.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, [axis, open, pullBy, release]);

  // Mouse drag. `useClickDragScroll` scrolls a column by its scrollTop, which
  // a closed fold has none of, so the pull is read here instead. The page's
  // own sideways pan is left alone.
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    dragFrom.current = { x: event.clientX, y: event.clientY };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const from = dragFrom.current;
      if (!from || open) return;
      const travel = axis === "y" ? from.y - event.clientY : from.x - event.clientX;
      dragFrom.current = { x: event.clientX, y: event.clientY };
      pullBy(travel);
    },
    [axis, open, pullBy],
  );

  // Back at the start, the fold locks again.
  const onScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || !open) return;
    const offset = axis === "y" ? node.scrollTop : node.scrollLeft;
    if (offset <= 0) setOpen(false);
  }, [axis, open]);

  const offset = Math.round(pull * ADVANCED_FOLD_RESISTANCE);
  const style = offset
    ? { transform: axis === "y" ? `translateY(${-offset}px)` : `translateX(${-offset}px)` }
    : undefined;

  return (
    <div
      ref={scrollerRef}
      className={`advanced-fold ${className}`.trim()}
      data-axis={axis}
      data-open={open ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerLeave={release}
      onScroll={onScroll}
    >
      <div className="advanced-fold-track" style={style}>
        <div className="advanced-fold-default">{children}</div>
        <AdvancedFoldDivider />
        {open ? <div className="advanced-fold-advanced">{advanced}</div> : null}
      </div>
    </div>
  );
}

function AdvancedFoldDivider() {
  return (
    <div className="advanced-fold-divider" aria-hidden="true">
      <span className="advanced-fold-divider-label">
        Advanced
        <span className="advanced-fold-divider-arrow" />
      </span>
      <span className="advanced-fold-divider-line" />
    </div>
  );
}
