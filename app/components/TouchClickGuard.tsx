"use client";

import { useEffect, useRef } from "react";

const ACTION_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
].join(",");
const CLICK_SUPPRESS_MS = 700;
const SCROLL_THRESHOLD_PX = 2;
const TOUCH_MOVE_THRESHOLD_PX = 10;

type TouchGesture = {
  action: Element | null;
  moved: boolean;
  pointerId?: number;
  startScrollX: number;
  startScrollY: number;
  startX: number;
  startY: number;
};

function closestAction(target: EventTarget | null) {
  return target instanceof Element ? target.closest(ACTION_SELECTOR) : null;
}

function gestureMoved(gesture: TouchGesture, x: number, y: number) {
  const pointerMoved = Math.hypot(x - gesture.startX, y - gesture.startY) > TOUCH_MOVE_THRESHOLD_PX;
  const pageScrolled =
    Math.abs(window.scrollX - gesture.startScrollX) > SCROLL_THRESHOLD_PX ||
    Math.abs(window.scrollY - gesture.startScrollY) > SCROLL_THRESHOLD_PX;

  return pointerMoved || pageScrolled;
}

export function TouchClickGuard() {
  const gestureRef = useRef<TouchGesture | null>(null);
  const suppressedClickRef = useRef<{ action: Element; until: number } | null>(null);

  useEffect(() => {
    const begin = (target: EventTarget | null, x: number, y: number, pointerId?: number) => {
      gestureRef.current = {
        action: closestAction(target),
        moved: false,
        pointerId,
        startScrollX: window.scrollX,
        startScrollY: window.scrollY,
        startX: x,
        startY: y,
      };
    };

    const move = (x: number, y: number, pointerId?: number) => {
      const gesture = gestureRef.current;
      if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) {
        return;
      }

      gesture.moved = gesture.moved || gestureMoved(gesture, x, y);
    };

    const finish = (x: number, y: number, pointerId?: number) => {
      const gesture = gestureRef.current;
      if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) {
        return;
      }

      if (gesture.action && (gesture.moved || gestureMoved(gesture, x, y))) {
        suppressedClickRef.current = {
          action: gesture.action,
          until: performance.now() + CLICK_SUPPRESS_MS,
        };
      }

      gestureRef.current = null;
    };

    const markScrolled = () => {
      const gesture = gestureRef.current;
      if (gesture) {
        gesture.moved = gesture.moved || gestureMoved(gesture, gesture.startX, gesture.startY);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) {
        return;
      }
      begin(event.target, event.clientX, event.clientY, event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        move(event.clientX, event.clientY, event.pointerId);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        finish(event.clientX, event.clientY, event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        finish(event.clientX, event.clientY, event.pointerId);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (window.PointerEvent || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      begin(event.target, touch.clientX, touch.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (window.PointerEvent || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      move(touch.clientX, touch.clientY);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (window.PointerEvent) {
        return;
      }

      const touch = event.changedTouches[0];
      finish(touch?.clientX ?? 0, touch?.clientY ?? 0);
    };

    const onClick = (event: MouseEvent) => {
      const suppressed = suppressedClickRef.current;
      if (!suppressed) {
        return;
      }

      if (performance.now() > suppressed.until) {
        suppressedClickRef.current = null;
        return;
      }

      const action = closestAction(event.target);
      if (action !== suppressed.action) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressedClickRef.current = null;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("touchstart", onTouchStart, true);
    document.addEventListener("touchmove", onTouchMove, true);
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", markScrolled, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", markScrolled, true);
    };
  }, []);

  return null;
}
