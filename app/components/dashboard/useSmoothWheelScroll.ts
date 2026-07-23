"use client";

import { useEffect, useRef, useState } from "react";

import { useLiteMode } from "./experienceModeSetting";
import { setPageUpdatesPaused } from "./pageUpdatePause";
import { useSmoothScrollSetting, useSmoothScrollSpeedSetting } from "./smoothScrollSetting";

// Eased mouse-wheel scrolling for the page (window) scroll. This is the WHEEL
// half of the layered smooth-scroll design; CSS `scroll-behavior: smooth`
// (globals.css) already handles anchor/hash, arrow & Page/Home/End keys, and
// programmatic jumps. Touch is intentionally left native (already inertial) and
// scrollbar drag is left native (direct, 1:1). See SPEC.md §"Experience Modes".
//
// Hard-gated: the engine registers NO listeners unless the per-device preference
// is on AND the device is not in lite mode AND the user has not asked for
// reduced motion. That is also how the low-power kiosk (the archetypal lite
// device) gets native scrolling with no machine-specific code.
//
// Precision: a minimal wheel notch must land on exactly its pixel — the target
// is a float, raw deltas are never rounded away, and the animation snaps to the
// exact target on its final frame rather than stopping a pixel short.

// Below this gap (device pixels) we snap to the exact target and stop.
const SETTLE_EPSILON = 0.5;
// deltaMode conversions: lines and pages → pixels.
const LINE_HEIGHT_PX = 16;
const REFERENCE_FRAME_MS = 1000 / 60;

// Convert the configured 60 Hz approach fraction to elapsed-time damping.
// Scroll duration therefore stays stable when rendering falls to 30 or 15 fps.
export function dampingAlpha(perFrameFraction: number, elapsedMs: number): number {
  const frames = Math.max(0, elapsedMs) / REFERENCE_FRAME_MS;
  return 1 - Math.pow(1 - perFrameFraction, frames);
}

/**
 * True when the wheel should scroll something *other* than the page — an inner
 * scrollable region that can still move in the wheel's direction, the maplibre
 * map (which runs its own {passive:false} wheel-zoom), or an explicit opt-out.
 * Walks up from the event target and stops at <body>: the page root itself is
 * never treated as an inner region.
 */
function shouldDeferToNative(target: EventTarget | null, deltaY: number): boolean {
  let node = target instanceof Element ? target : null;
  const root = document.body;

  while (node && node !== root && node !== document.documentElement) {
    // Explicit opt-out and the maplibre map both keep their native wheel.
    if (node.hasAttribute("data-nova-no-smooth-scroll") || node.closest(".maplibregl-map")) {
      return true;
    }

    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1;

    if (scrollable) {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop >= node.scrollHeight - node.clientHeight - 1;
      // Only defer if this region can actually absorb the scroll in this
      // direction; at its boundary the page should take over.
      if ((deltaY > 0 && !atBottom) || (deltaY < 0 && !atTop)) {
        return true;
      }
    }

    node = node.parentElement;
  }

  return false;
}

function normaliseDeltaY(event: WheelEvent): number {
  if (event.deltaMode === 1) {
    return event.deltaY * LINE_HEIGHT_PX;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * window.innerHeight;
  }
  return event.deltaY;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    // Safari < 14 only supports the deprecated addListener signature.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  return reduced;
}

/**
 * Mount once (via SmoothScrollController). Attaches an eased wheel handler to
 * the window while enabled and tears it down completely when disabled.
 */
export function useSmoothWheelScroll(): void {
  const [pref] = useSmoothScrollSetting();
  const [speed] = useSmoothScrollSpeedSetting();
  const lite = useLiteMode();
  const reducedMotion = usePrefersReducedMotion();
  const enabled = pref && !lite && !reducedMotion;

  // Read via ref inside the animation loop so a live slider drag applies
  // immediately without tearing down and re-attaching the wheel listener.
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let target = window.scrollY; // float; the destination we ease toward
    let current = window.scrollY; // float; our tracked live position
    let raf = 0;
    let animating = false;
    let lastFrameAt = performance.now();

    const maxScroll = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const step = (now: number) => {
      const gap = target - current;
      if (Math.abs(gap) <= SETTLE_EPSILON) {
        // Snap to the exact target so a 1px input lands on exactly 1px.
        current = target;
        window.scrollTo({ top: current, behavior: "auto" });
        raf = 0;
        animating = false;
        setPageUpdatesPaused(false);
        return;
      }
      const elapsedMs = Math.min(100, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      current += gap * dampingAlpha(speedRef.current, elapsedMs);
      window.scrollTo({ top: current, behavior: "auto" });
      raf = window.requestAnimationFrame(step);
    };

    const onWheel = (event: WheelEvent) => {
      // Let modifier gestures (pinch-zoom, browser zoom) and horizontal wheels
      // pass through untouched.
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return;
      }
      const deltaY = normaliseDeltaY(event);
      if (deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }
      if (shouldDeferToNative(event.target, deltaY)) {
        return;
      }

      event.preventDefault();
      // Yield expensive dashboard work before the first scroll frame. The
      // passive scroll listener keeps this active until movement settles.
      setPageUpdatesPaused(true);

      // Re-sync to the real position when starting a fresh gesture so anchor
      // smooth-scrolls, scroll-restore, or a manual scrollbar drag between
      // gestures are respected rather than yanked back by stale momentum.
      if (!animating) {
        current = window.scrollY;
        target = window.scrollY;
      }

      target = Math.min(maxScroll(), Math.max(0, target + deltaY));

      if (!animating) {
        animating = true;
        lastFrameAt = performance.now();
        raf = window.requestAnimationFrame(step);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
      setPageUpdatesPaused(false);
    };
  }, [enabled]);
}
