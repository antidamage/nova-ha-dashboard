"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { playUxSound } from "../controlSound";
import { useWideDashboard } from "../HorizontalAccordion";
import {
  ADVANCED_FOLD_BREAK_EASING,
  ADVANCED_FOLD_INERTIA_WINDOW_MS,
  ADVANCED_FOLD_BREAK_MS,
  ADVANCED_FOLD_SPRING_BACK_EASING,
  ADVANCED_FOLD_SPRING_BACK_MS,
  ADVANCED_FOLD_TOUCH_AXIS_PX,
  ADVANCED_FOLD_WHEEL_FACTOR,
  ADVANCED_FOLD_WHEEL_IDLE_MS,
  bandBroken,
  bandDisplacement,
  breakOffset,
  flickVelocity,
  inertiaStep,
  type FoldBand,
  startsInInnerScroller,
  startsOnOwnDragControl,
  wheelAxisDelta,
  wheelDeltaPx,
} from "../advancedFoldBand";
import {
  clientSize,
  maxOffset,
  prefersReducedMotion,
  readOffset,
  translate,
  writeOffset,
} from "./scroller-model";
import type { AdvancedFoldProps, Axis } from "./types";

/**
 * A sub-panel: its own scroller, holding a default view, a sunken "Advanced"
 * line at the end of that view, and the detail past the line. See
 * specs/advanced-fold.md.
 *
 * Closed, the advanced region is not mounted, so the scroller can go no
 * further than the line (the boundary). Travel past it is caught by a rubber
 * band (160px for a drag, 80px for the wheel); at the break the region mounts and the content lands where 1:1
 * tracking would have put it. Scrolling back to the boundary closes it again.
 *
 * With no `advanced` content it is only the scroller: no line, no gesture.
 *
 * Landscape folds downward (offset = scrollTop), portrait sideways to the
 * right (offset = scrollLeft).
 */

// Re-exported for callers and tests that drive the gesture.
export { ADVANCED_FOLD_DRAG_BREAK_PX, ADVANCED_FOLD_WHEEL_BREAK_PX } from "../advancedFoldBand";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AdvancedFold({ advanced, children, className = "", as = "div", ...rest }: AdvancedFoldProps) {
  const wide = useWideDashboard();
  const axis: Axis = wide ? "y" : "x";
  const foldless = advanced === undefined || advanced === null || advanced === false;

  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  /** Input travel caught by the band in the current pull. */
  const pullRef = useRef(0);
  /** Displacement currently applied to the track by the band. */
  const displacedRef = useRef(0);
  /** The closed fold's largest offset, captured when it last opened. */
  const boundaryRef = useRef(0);
  /** A break waiting for the advanced region to mount. */
  const pendingBreakRef = useRef<{ pull: number; displaced: number; band: FoldBand } | null>(null);
  /** An offset the fold wrote itself; its scroll event is not the user's. */
  const selfWriteRef = useRef<number | null>(null);
  /** The offset at the last scroll event, to tell a content-shrink clamp apart. */
  const lastOffsetRef = useRef(0);
  const lastMaxRef = useRef(0);
  /** Set when a break found nothing to open onto; the band holds until the gesture ends. */
  const deadRef = useRef(false);
  const wheelIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setOpenState = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
  }, []);

  const clearTransition = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "";
    if (!pullRef.current) track.style.transform = "";
  }, []);

  /** Moves the band with no transition. */
  const applyBand = useCallback((pull: number, band: FoldBand) => {
    const track = trackRef.current;
    pullRef.current = pull;
    const displaced = pull > 0 ? bandDisplacement(pull, band) : 0;
    displacedRef.current = displaced;
    if (!track) return;
    track.style.transition = "none";
    track.style.transform = translate(axis, -displaced);
  }, [axis]);

  /** Returns the band to rest: a spring, or straight there with reduced motion. */
  const springBack = useCallback(() => {
    const track = trackRef.current;
    const wasDisplaced = displacedRef.current;
    pullRef.current = 0;
    displacedRef.current = 0;
    if (!track) return;
    if (!wasDisplaced || prefersReducedMotion()) {
      track.style.transition = "";
      track.style.transform = "";
      return;
    }
    void track.offsetWidth;
    track.style.transition = `transform ${ADVANCED_FOLD_SPRING_BACK_MS}ms ${ADVANCED_FOLD_SPRING_BACK_EASING}`;
    track.style.transform = "none";
  }, []);

  /**
   * touch-action is read at touchstart, so it is set ahead for the next
   * gesture. The fold drives every touch along its axis itself, open or
   * closed (a native pan cannot be taken over at the boundary), so only the
   * cross axis, the page's pan, is left to the browser.
   */
  const syncTouchAction = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.style.touchAction = foldless ? "" : axis === "y" ? "pan-x" : "pan-y";
  }, [axis, foldless]);

  const close = useCallback(() => {
    // The heal sound only for a fold that was actually open: `close` also runs
    // on every mount and layout flip (specs/ux-sounds.md).
    if (openRef.current) playUxSound("foldHeal");
    pendingBreakRef.current = null;
    pullRef.current = 0;
    displacedRef.current = 0;
    const track = trackRef.current;
    if (track) {
      track.style.transition = "";
      track.style.transform = "";
    }
    setOpenState(false);
  }, [setOpenState]);

  /** The band has broken: open, and let the layout effect place the content. */
  const breakOpen = useCallback((pull: number, band: FoldBand) => {
    const node = scrollerRef.current;
    if (!node || deadRef.current) return;
    boundaryRef.current = maxOffset(node, axis);
    pendingBreakRef.current = { pull, displaced: displacedRef.current, band };
    pullRef.current = 0;
    setOpenState(true);
  }, [axis, setOpenState]);

  /**
   * Travel toward Advanced (positive) or back (negative) for a gesture the
   * fold drives itself: a mouse or touch drag.
   */
  const drive = useCallback((delta: number) => {
    const node = scrollerRef.current;
    if (!node || !delta) return;

    if (openRef.current) {
      // Broken, but React has not committed the open region yet: keep the
      // travel so the break lands where 1:1 tracking would have put it.
      if (pendingBreakRef.current) {
        pendingBreakRef.current.pull += delta;
        return;
      }
      const max = maxOffset(node, axis);
      const next = Math.min(Math.max(readOffset(node, axis) + delta, 0), max);
      writeOffset(node, axis, next);
      lastOffsetRef.current = readOffset(node, axis);
      lastMaxRef.current = max;
      if (delta < 0 && readOffset(node, axis) <= boundaryRef.current + 0.5) close();
      return;
    }

    const boundary = maxOffset(node, axis);
    const offset = readOffset(node, axis);
    if (pullRef.current > 0 || (delta > 0 && offset >= boundary - 1)) {
      const next = pullRef.current + delta;
      if (next <= 0) {
        applyBand(0, "drag");
        clearTransition();
        if (next < 0) writeOffset(node, axis, Math.max(0, offset + next));
        return;
      }
      if (bandBroken(next, "drag") && !deadRef.current) {
        applyBand(next, "drag");
        breakOpen(next, "drag");
        return;
      }
      applyBand(next, "drag");
      return;
    }

    // Free travel through a default view taller than the sub-panel.
    const target = offset + delta;
    const clamped = Math.min(Math.max(target, 0), boundary);
    writeOffset(node, axis, clamped);
    const leftover = target - clamped;
    if (leftover > 0) applyBand(leftover, "drag");
  }, [applyBand, axis, breakOpen, clearTransition, close]);

  /** A flick carried on after the finger lifted, as a rAF id. */
  const inertiaRef = useRef<number | null>(null);

  const stopInertia = useCallback(() => {
    if (inertiaRef.current !== null) cancelAnimationFrame(inertiaRef.current);
    inertiaRef.current = null;
  }, []);

  /**
   * Carries a touch flick on with friction. Open, it scrolls and may close the
   * fold at the boundary, then stops; closed, it scrolls the default view and
   * stops at the boundary, never feeding the band.
   */
  const startInertia = useCallback((velocity: number) => {
    stopInertia();
    if (!velocity || prefersReducedMotion() || typeof requestAnimationFrame !== "function") return;
    let v = velocity;
    let lastTime: number | null = null;
    const frame = (time: number) => {
      const node = scrollerRef.current;
      if (!node || pendingBreakRef.current) {
        inertiaRef.current = null;
        return;
      }
      const step = inertiaStep(v, lastTime === null ? undefined : time - lastTime);
      lastTime = time;
      v = step.velocity;
      const offset = readOffset(node, axis);
      let stop = v === 0;
      if (openRef.current) {
        const max = maxOffset(node, axis);
        const next = Math.min(Math.max(offset + step.distance, 0), max);
        if (step.distance < 0 && next <= boundaryRef.current + 0.5) {
          writeOffset(node, axis, boundaryRef.current);
          close();
          stop = true;
        } else {
          writeOffset(node, axis, next);
          if (next !== offset + step.distance) stop = true;
        }
      } else {
        const boundary = maxOffset(node, axis);
        const next = Math.min(Math.max(offset + step.distance, 0), boundary);
        writeOffset(node, axis, next);
        if (next !== offset + step.distance) stop = true;
      }
      lastOffsetRef.current = readOffset(node, axis);
      inertiaRef.current = stop ? null : requestAnimationFrame(frame);
    };
    inertiaRef.current = requestAnimationFrame(frame);
  }, [axis, close, stopInertia]);

  // The break: the advanced region has mounted; place the content and rubber-band to it.
  useIsoLayoutEffect(() => {
    const pending = pendingBreakRef.current;
    const node = scrollerRef.current;
    const track = trackRef.current;
    if (!open || !pending || !node) return;
    pendingBreakRef.current = null;

    const boundary = boundaryRef.current;
    const max = maxOffset(node, axis);
    if (max <= boundary + 0.5) {
      // Nothing past the line to scroll to: stay shut.
      // The band holds at its limit until the gesture ends.
      deadRef.current = true;
      openRef.current = false;
      setOpen(false);
      applyBand(pending.pull, pending.band);
      return;
    }

    // The break has taken: sounded here rather than in breakOpen, because a
    // dead break above reverts and must stay silent (specs/ux-sounds.md).
    playUxSound("foldBreak");
    writeOffset(node, axis, breakOffset(boundary, Math.max(0, pending.pull), max));
    const applied = readOffset(node, axis);
    selfWriteRef.current = applied;
    lastOffsetRef.current = applied;
    lastMaxRef.current = max;
    displacedRef.current = 0;
    syncTouchAction();
    if (!track) return;

    // Where the content was drawn, and where the new offset alone would draw it.
    const compensation = applied - (boundary + pending.displaced);
    if (prefersReducedMotion() || Math.abs(compensation) < 0.5) {
      track.style.transition = "";
      track.style.transform = "";
      return;
    }
    track.style.transition = "none";
    track.style.transform = translate(axis, compensation);
    void track.offsetWidth;
    track.style.transition = `transform ${ADVANCED_FOLD_BREAK_MS}ms ${ADVANCED_FOLD_BREAK_EASING}`;
    track.style.transform = "none";
  }, [open]);

  // A fold is closed on every load and every layout flip; nothing is persisted.
  useEffect(() => {
    close();
    deadRef.current = false;
  }, [axis, close]);

  // The default area's floor: the scroller's content box less the divider, so
  // the line sits just inside the sub-panel and the area never changes size
  // when Advanced opens.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const measure = () => {
      syncTouchAction();
      const divider = dividerRef.current;
      if (foldless || !divider) {
        node.style.removeProperty("--advanced-fold-default-min");
        return;
      }
      // Measure without the floor in place. With it applied, a scroller whose
      // height comes from its content would read its own floor back and only
      // ever grow. Removing it can clamp the offset during the forced layout,
      // so the offset is put back afterwards.
      const offset = readOffset(node, axis);
      node.style.removeProperty("--advanced-fold-default-min");
      const style = window.getComputedStyle(node);
      const padding = axis === "y"
        ? (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
        : (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const rect = divider.getBoundingClientRect();
      const dividerSize = axis === "y" ? rect.height : rect.width;
      const content = clientSize(node, axis) - padding;
      node.style.setProperty(
        "--advanced-fold-default-min",
        `${Math.max(0, Math.floor(content) - Math.ceil(dividerSize))}px`,
      );
      if (readOffset(node, axis) !== offset) {
        writeOffset(node, axis, offset);
        selfWriteRef.current = readOffset(node, axis);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (dividerRef.current) observer.observe(dividerRef.current);
    return () => observer.disconnect();
  }, [axis, foldless, syncTouchAction]);

  // Clear a spring's transition once it has finished.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onEnd = (event: TransitionEvent) => {
      if (event.target === track && event.propertyName === "transform") clearTransition();
    };
    track.addEventListener("transitionend", onEnd);
    return () => track.removeEventListener("transitionend", onEnd);
  }, [clearTransition, foldless]);

  // Scroll: the user coming back to the boundary closes the fold.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    const onScroll = () => {
      const offset = readOffset(node, axis);
      const max = maxOffset(node, axis);
      const last = lastOffsetRef.current;
      lastOffsetRef.current = offset;
      lastMaxRef.current = max;
      if (selfWriteRef.current !== null && Math.abs(offset - selfWriteRef.current) < 1) {
        selfWriteRef.current = null;
        return;
      }
      selfWriteRef.current = null;
      if (openRef.current && !pendingBreakRef.current) {
        // Advanced's own content shrank and the browser clamped the offset.
        const clamped = last > max + 0.5 && offset >= max - 1;
        if (!clamped && offset <= boundaryRef.current + 0.5) close();
      }
      syncTouchAction();
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [axis, close, foldless, syncTouchAction]);

  // Wheel, at a quarter.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    /** The last wheel event that fed the band, by its own timestamp. */
    let lastWheel: { time: number; pull: number } | null = null;
    const onWheel = (event: WheelEvent) => {
      stopInertia();
      if (event.ctrlKey || event.defaultPrevented) return;
      const raw = wheelAxisDelta(axis, event.deltaX, event.deltaY);
      if (!raw) return;
      const delta = wheelDeltaPx(raw, event.deltaMode, clientSize(node, axis));

      if (openRef.current) {
        // Broken but not yet committed: the travel counts 1:1 toward the landing.
        if (pendingBreakRef.current) {
          event.preventDefault();
          pendingBreakRef.current.pull += delta;
          return;
        }
        // Nothing left to scroll back through (a clamp put it on the boundary).
        if (delta < 0 && readOffset(node, axis) <= boundaryRef.current + 0.5) {
          event.preventDefault();
          close();
        }
        return;
      }

      // Wheel events are delivered with frames, so on a busy page the idle
      // timer can run ahead of notches that arrived in time. The pause is
      // judged by the events' own timestamps, and a pull the timer let go
      // early is carried on.
      let pull = pullRef.current;
      if (pull <= 0 && lastWheel && lastWheel.pull > 0 && event.timeStamp - lastWheel.time < ADVANCED_FOLD_WHEEL_IDLE_MS) {
        pull = lastWheel.pull;
      }
      const boundary = maxOffset(node, axis);
      if (pull <= 0 && (delta < 0 || readOffset(node, axis) < boundary - 1)) return;

      event.preventDefault();
      const next = Math.max(0, pull + delta * ADVANCED_FOLD_WHEEL_FACTOR);
      lastWheel = { time: event.timeStamp, pull: next };
      if (wheelIdleRef.current) clearTimeout(wheelIdleRef.current);
      if (bandBroken(next, "wheel") && !deadRef.current) {
        lastWheel = null;
        breakOpen(next, "wheel");
        wheelIdleRef.current = setTimeout(() => {
          wheelIdleRef.current = null;
          deadRef.current = false;
          // A break with nothing to open onto leaves the band held; let it go.
          if (!openRef.current) springBack();
        }, ADVANCED_FOLD_WHEEL_IDLE_MS);
        return;
      }
      applyBand(next, "wheel");
      wheelIdleRef.current = setTimeout(() => {
        wheelIdleRef.current = null;
        deadRef.current = false;
        if (!openRef.current) springBack();
      }, ADVANCED_FOLD_WHEEL_IDLE_MS);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      if (wheelIdleRef.current) clearTimeout(wheelIdleRef.current);
    };
  }, [applyBand, axis, breakOpen, close, foldless, springBack, stopInertia]);

  // Touch. Non-passive moves: the fold drives travel along its axis itself, in
  // both directions, from anywhere in the sub-panel that is not a control, and
  // carries a flick on with inertia after the finger lifts.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    let start: { x: number; y: number; target: EventTarget | null } | null = null;
    let last = { x: 0, y: 0 };
    let decided: "fold" | "native" | null = null;
    /** Travel toward Advanced over time, for the release velocity. */
    let samples: { time: number; pos: number }[] = [];
    let travelled = 0;

    const onStart = (event: TouchEvent) => {
      stopInertia();
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1 || startsOnOwnDragControl(event.target, node)) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, target: event.target };
      last = { x: touch.clientX, y: touch.clientY };
      decided = null;
      samples = [{ time: event.timeStamp, pos: 0 }];
      travelled = 0;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (!decided) {
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        // Decided on the first cancelable move, while the page's pan can still
        // be withheld; a move with no travel yet waits for the next.
        if (!event.cancelable || (dx === 0 && dy === 0)) {
          if (!event.cancelable) decided = "native";
          return;
        }
        const alongFold = axis === "y" ? Math.abs(dy) >= Math.abs(dx) : Math.abs(dx) > Math.abs(dy);
        // Toward Advanced is a finger moving up (landscape) or left (portrait).
        const direction = axis === "y" ? -dy : -dx;
        decided = alongFold && !startsInInnerScroller(start.target, node, axis, direction) ? "fold" : "native";
        // The rest of this gesture is the fold's alone: no diagonal page pan.
        if (decided === "fold") node.style.touchAction = "none";
      }
      if (decided !== "fold") return;
      if (event.cancelable) event.preventDefault();
      const delta = axis === "y" ? last.y - touch.clientY : last.x - touch.clientX;
      last = { x: touch.clientX, y: touch.clientY };
      travelled += delta;
      samples.push({ time: event.timeStamp, pos: travelled });
      if (samples.length > 20) samples.shift();
      drive(delta);
    };
    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const wasFold = decided === "fold";
      start = null;
      decided = null;
      deadRef.current = false;
      if (!openRef.current && pullRef.current > 0) springBack();
      else if (wasFold && !pendingBreakRef.current) {
        const idle = event.timeStamp - (samples[samples.length - 1]?.time ?? event.timeStamp);
        if (idle < ADVANCED_FOLD_INERTIA_WINDOW_MS) startInertia(flickVelocity(samples));
      }
      samples = [];
      syncTouchAction();
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
      stopInertia();
    };
  }, [axis, drive, foldless, springBack, startInertia, stopInertia, syncTouchAction]);

  // Mouse drag: driven by the fold once it has moved past the tap threshold,
  // from anywhere in the sub-panel that is not a control. The page's own drag
  // still pans the page with the cross-axis travel (useClickDragScroll).
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    let start: { x: number; y: number; target: EventTarget | null } | null = null;
    let last: { x: number; y: number } | null = null;

    const onMove = (event: MouseEvent) => {
      if (!start) return;
      if (!last) {
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < ADVANCED_FOLD_TOUCH_AXIS_PX) return;
        const direction = axis === "y" ? -dy : -dx;
        if (startsInInnerScroller(start.target, node, axis, direction)) {
          start = null;
          return;
        }
        // A drag over a title is not a text selection.
        window.getSelection?.()?.removeAllRanges();
        node.classList.add("advanced-fold-dragging");
        // The travel under the threshold still counts toward the pull.
        last = { x: start.x, y: start.y };
      }
      const delta = axis === "y" ? last.y - event.clientY : last.x - event.clientX;
      last = { x: event.clientX, y: event.clientY };
      drive(delta);
    };
    const onUp = () => {
      start = null;
      last = null;
      node.classList.remove("advanced-fold-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      deadRef.current = false;
      if (!openRef.current && pullRef.current > 0) springBack();
      syncTouchAction();
    };
    const onDown = (event: MouseEvent) => {
      stopInertia();
      if (event.button !== 0 || startsOnOwnDragControl(event.target, node)) return;
      start = { x: event.clientX, y: event.clientY, target: event.target };
      last = null;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    node.addEventListener("mousedown", onDown);
    return () => {
      node.removeEventListener("mousedown", onDown);
      node.classList.remove("advanced-fold-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, drive, foldless, springBack, stopInertia, syncTouchAction]);

  const Element = as;
  const classes = `advanced-fold ${className}`.trim();
  const setScroller = (node: HTMLElement | null) => {
    scrollerRef.current = node;
  };

  if (foldless) {
    return (
      <Element {...rest} ref={setScroller} className={classes} data-axis={axis} data-foldless="true">
        {children}
      </Element>
    );
  }

  return (
    <Element {...rest} ref={setScroller} className={classes} data-axis={axis} data-open={open ? "true" : "false"}>
      <div ref={trackRef} className="advanced-fold-track">
        <div className="advanced-fold-default">{children}</div>
        <div ref={dividerRef} className="advanced-fold-divider" aria-hidden="true">
          <span className="advanced-fold-divider-label">
            Advanced
            <span className="advanced-fold-divider-arrow" />
          </span>
          <span className="advanced-fold-divider-line" />
        </div>
        {open ? <div className="advanced-fold-advanced">{advanced}</div> : null}
      </div>
    </Element>
  );
}
