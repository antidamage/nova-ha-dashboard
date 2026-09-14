"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useWideDashboard } from "./HorizontalAccordion";
import {
  ADVANCED_FOLD_BREAK_EASING,
  ADVANCED_FOLD_BREAK_MS,
  ADVANCED_FOLD_SPRING_BACK_EASING,
  ADVANCED_FOLD_SPRING_BACK_MS,
  ADVANCED_FOLD_TOUCH_AXIS_PX,
  ADVANCED_FOLD_WHEEL_FACTOR,
  ADVANCED_FOLD_WHEEL_IDLE_MS,
  bandBroken,
  bandDisplacement,
  breakOffset,
  startsInInnerScroller,
  startsOnOwnDragControl,
  wheelAxisDelta,
  wheelDeltaPx,
} from "./advancedFoldBand";

/**
 * A sub-panel: its own scroller, holding a default view, a sunken "Advanced"
 * line at the end of that view, and the detail past the line. See
 * specs/advanced-fold.md.
 *
 * Closed, the advanced region is not mounted, so the scroller can go no
 * further than the line (the boundary). Travel past it is caught by an 80px
 * rubber band; at the break the region mounts and the content lands where 1:1
 * tracking would have put it. Scrolling back to the boundary closes it again.
 *
 * With no `advanced` content it is only the scroller: no line, no gesture.
 *
 * Landscape folds downward (offset = scrollTop), portrait sideways to the
 * right (offset = scrollLeft).
 */

// Re-exported for callers and tests that drive the gesture.
export { ADVANCED_FOLD_BREAK_PX } from "./advancedFoldBand";

type Axis = "x" | "y";
type Tag = "div" | "section";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readOffset(node: HTMLElement, axis: Axis) {
  return axis === "y" ? node.scrollTop : node.scrollLeft;
}

function writeOffset(node: HTMLElement, axis: Axis, value: number) {
  if (axis === "y") node.scrollTop = value;
  else node.scrollLeft = value;
}

function clientSize(node: HTMLElement, axis: Axis) {
  return axis === "y" ? node.clientHeight : node.clientWidth;
}

function maxOffset(node: HTMLElement, axis: Axis) {
  const scroll = axis === "y" ? node.scrollHeight : node.scrollWidth;
  return Math.max(0, scroll - clientSize(node, axis));
}

function translate(axis: Axis, px: number) {
  if (Math.abs(px) < 0.01) return "none";
  return axis === "y" ? `translateY(${px}px)` : `translateX(${px}px)`;
}

export type AdvancedFoldProps = Omit<HTMLAttributes<HTMLElement>, "children" | "className"> & {
  /** What sits past the line. Omitted or null: a plain scroller with no fold. */
  advanced?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The element the scroller is rendered as. */
  as?: Tag;
};

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
  const pendingBreakRef = useRef<{ pull: number; displaced: number } | null>(null);
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
  const applyBand = useCallback((pull: number) => {
    const track = trackRef.current;
    pullRef.current = pull;
    const displaced = pull > 0 ? bandDisplacement(pull) : 0;
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

  /** touch-action is read at touchstart, so it is set ahead for the next gesture. */
  const syncTouchAction = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    if (foldless) {
      node.style.touchAction = "";
      return;
    }
    const locked = !openRef.current && readOffset(node, axis) >= maxOffset(node, axis) - 1;
    node.style.touchAction = locked ? (axis === "y" ? "pan-x" : "pan-y") : "";
  }, [axis, foldless]);

  const close = useCallback(() => {
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
  const breakOpen = useCallback((pull: number) => {
    const node = scrollerRef.current;
    if (!node || deadRef.current) return;
    boundaryRef.current = maxOffset(node, axis);
    pendingBreakRef.current = { pull, displaced: displacedRef.current };
    pullRef.current = 0;
    setOpenState(true);
  }, [axis, setOpenState]);

  /**
   * Travel toward Advanced (positive) or back (negative) for a gesture the
   * fold drives itself: a mouse drag, or a touch that began locked.
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
        applyBand(0);
        clearTransition();
        if (next < 0) writeOffset(node, axis, Math.max(0, offset + next));
        return;
      }
      if (bandBroken(next) && !deadRef.current) {
        applyBand(next);
        breakOpen(next);
        return;
      }
      applyBand(next);
      return;
    }

    // Free travel through a default view taller than the sub-panel.
    const target = offset + delta;
    const clamped = Math.min(Math.max(target, 0), boundary);
    writeOffset(node, axis, clamped);
    const leftover = target - clamped;
    if (leftover > 0) applyBand(leftover);
  }, [applyBand, axis, breakOpen, clearTransition, close]);

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
      applyBand(pending.pull);
      return;
    }

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
      if (bandBroken(next) && !deadRef.current) {
        lastWheel = null;
        breakOpen(next);
        wheelIdleRef.current = setTimeout(() => {
          wheelIdleRef.current = null;
          deadRef.current = false;
          // A break with nothing to open onto leaves the band held; let it go.
          if (!openRef.current) springBack();
        }, ADVANCED_FOLD_WHEEL_IDLE_MS);
        return;
      }
      applyBand(next);
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
  }, [applyBand, axis, breakOpen, close, foldless, springBack]);

  // Touch. Non-passive moves, so a locked pull is not scrolled out from under the band.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    let start: { x: number; y: number } | null = null;
    let last = { x: 0, y: 0 };
    let decided: "fold" | "cross" | null = null;
    let driven = false;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (
        !touch ||
        event.touches.length > 1 ||
        startsOnOwnDragControl(event.target, node) ||
        startsInInnerScroller(event.target, node, axis)
      ) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY };
      last = start;
      decided = null;
      // Only a touch that began locked has its fold-axis pan withheld by
      // touch-action; any other touch scrolls natively.
      driven = !openRef.current && readOffset(node, axis) >= maxOffset(node, axis) - 1;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch || !driven) return;
      if (!decided) {
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < ADVANCED_FOLD_TOUCH_AXIS_PX) return;
        const alongFold = axis === "y" ? Math.abs(dy) >= Math.abs(dx) : Math.abs(dx) > Math.abs(dy);
        decided = alongFold ? "fold" : "cross";
      }
      if (decided !== "fold") return;
      const delta = axis === "y" ? last.y - touch.clientY : last.x - touch.clientX;
      last = { x: touch.clientX, y: touch.clientY };
      if (event.cancelable) event.preventDefault();
      drive(delta);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      deadRef.current = false;
      if (!openRef.current && pullRef.current > 0) springBack();
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
    };
  }, [axis, drive, foldless, springBack, syncTouchAction]);

  // Mouse drag: always driven by the fold. The page's own drag still pans the
  // page with the cross-axis travel (useClickDragScroll).
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || foldless) return;
    let last: { x: number; y: number } | null = null;

    const onMove = (event: MouseEvent) => {
      if (!last) return;
      const delta = axis === "y" ? last.y - event.clientY : last.x - event.clientX;
      last = { x: event.clientX, y: event.clientY };
      drive(delta);
    };
    const onUp = () => {
      last = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      deadRef.current = false;
      if (!openRef.current && pullRef.current > 0) springBack();
      syncTouchAction();
    };
    const onDown = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        startsOnOwnDragControl(event.target, node) ||
        startsInInnerScroller(event.target, node, axis)
      ) return;
      last = { x: event.clientX, y: event.clientY };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    node.addEventListener("mousedown", onDown);
    return () => {
      node.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [axis, drive, foldless, springBack, syncTouchAction]);

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
