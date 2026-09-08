"use client";

import { useEffect, type RefObject } from "react";

// Click-and-drag ("hand tool") horizontal scrolling for ONE element — the config
// page's category nav. Press anywhere on the strip and drag sideways to pan it;
// the page itself never moves. Touch is left alone, as native inertial scrolling
// already pans the strip.
//
// Same click-vs-drag threshold as the page-level pan in useClickDragScroll: a
// press that never crosses it stays a click, so the category buttons still
// activate; once it crosses, the trailing click is eaten so a drag that ends on
// a button doesn't also select that category.

const DRAG_THRESHOLD_PX = 5;

export function useHorizontalDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    let pending = false;
    let dragging = false;
    let suppressClick = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;

    const stopTracking = () => {
      pending = false;
      dragging = false;
      el.style.cursor = "";
      document.documentElement.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!pending) {
        return;
      }
      if (!dragging) {
        if (
          Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX &&
          Math.abs(event.clientY - startY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        dragging = true;
        el.style.cursor = "grabbing";
        document.documentElement.style.userSelect = "none";
        lastX = event.clientX;
      }

      const dx = event.clientX - lastX;
      lastX = event.clientX;
      // Direct 1:1 input, never eased, and only ever this element's scrollLeft.
      el.scrollLeft -= dx;
      event.preventDefault();
    };

    const onMouseUp = () => {
      if (dragging) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      stopTracking();
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey) {
        return;
      }
      pending = true;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      lastX = event.clientX;
      window.addEventListener("mousemove", onMouseMove, { passive: false });
      window.addEventListener("mouseup", onMouseUp);
    };

    const onClickCapture = (event: MouseEvent) => {
      if (suppressClick) {
        event.stopPropagation();
        event.preventDefault();
        suppressClick = false;
      }
    };

    const onDragStart = (event: DragEvent) => {
      if (dragging) {
        event.preventDefault();
      }
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("click", onClickCapture, { capture: true });
    el.addEventListener("dragstart", onDragStart);
    window.addEventListener("blur", stopTracking);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("click", onClickCapture, { capture: true });
      el.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("blur", stopTracking);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.style.cursor = "";
      document.documentElement.style.userSelect = "";
    };
  }, [ref]);
}
