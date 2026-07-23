"use client";

import { useEffect } from "react";

// Click-and-drag ("hand tool") scrolling for MOUSE users. Press anywhere on the
// page and drag to pan the window scroll, mirroring the touch drag that already
// works. Touch is deliberately untouched — native inertial scrolling handles it
// and this hook binds only mouse events.
//
// A movement threshold keeps ordinary clicks working: a press that never moves
// past the threshold stays a click, so buttons and links still activate; once it
// crosses the threshold it becomes a drag and the trailing click (and any native
// link/image drag-and-drop) is suppressed.
//
// Controls that own their own press-drag — form fields, sliders, the maplibre
// map's pan — are skipped, as are inner scroll regions and anything tagged
// `data-nova-no-drag-scroll`. Everything else (cards, buttons, empty space) is
// draggable to pan.

const DRAG_THRESHOLD_PX = 5;

/**
 * True when a mousedown on this target must NOT begin a page pan: it lands on a
 * control that needs its own drag (input/textarea/select/[role=slider]/
 * contenteditable), the maplibre map, an inner scrollable region, or an explicit
 * opt-out. Walks up and stops at <body>. Note buttons and links are NOT skipped:
 * the click-vs-drag threshold lets them stay clickable while still being
 * draggable to scroll.
 */
export function startsInNonDraggable(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;

  while (node && node !== document.body && node !== document.documentElement) {
    if (node.hasAttribute("data-nova-no-drag-scroll") || node.closest(".maplibregl-map")) {
      return true;
    }

    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") {
      return true;
    }
    if (node.getAttribute("role") === "slider") {
      return true;
    }
    const editable = node.getAttribute("contenteditable");
    if (editable === "" || editable === "true" || editable === "plaintext-only") {
      return true;
    }
    if (node instanceof HTMLElement && node.isContentEditable) {
      return true;
    }

    // Inner scrollable regions keep their own wheel/drag behaviour.
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return true;
    }

    node = node.parentElement;
  }

  return false;
}

export function useClickDragScroll(): void {
  useEffect(() => {
    let pending = false; // mouse is down but movement hasn't crossed the threshold
    let dragging = false; // threshold crossed — actively panning the page
    let suppressClick = false; // eat the click that trails a real drag
    let startX = 0;
    let startY = 0;
    let lastY = 0;

    const beginDrag = () => {
      dragging = true;
      // Feedback + belt-and-suspenders against text/image selection while panning.
      document.documentElement.style.cursor = "grabbing";
      document.documentElement.style.userSelect = "none";
    };

    const stopTracking = () => {
      pending = false;
      dragging = false;
      document.documentElement.style.cursor = "";
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
        beginDrag();
        lastY = event.clientY;
      }

      const dy = event.clientY - lastY;
      lastY = event.clientY;
      // Instant — never inherit `scroll-behavior: smooth` (globals.css), which
      // would animate and lag every drag frame.
      window.scrollBy({ top: -dy, left: 0, behavior: "auto" });
      event.preventDefault();
    };

    const onMouseUp = () => {
      if (dragging) {
        // A click fires on the common ancestor right after this mouseup; eat it
        // so a drag that ends on a card/button doesn't also activate it. Clear
        // on the next macrotask in case no click follows.
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
      if (startsInNonDraggable(event.target)) {
        return;
      }
      pending = true;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      lastY = event.clientY;
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
      // Stop native link/image/text drag-and-drop from hijacking a pan.
      if (dragging) {
        event.preventDefault();
      }
    };

    const onWindowBlur = () => {
      // Released outside the window / focus lost mid-drag: stop cleanly.
      stopTracking();
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("click", onClickCapture, { capture: true });
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("click", onClickCapture, { capture: true });
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.documentElement.style.cursor = "";
      document.documentElement.style.userSelect = "";
    };
  }, []);
}
