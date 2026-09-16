"use client";

// Keeps the page still when a selection changes its layout.
//
// The dashboard home is one `width: max-content` flex row: overview, zones
// panel, tasks stage, transcript. Selecting a zone remounts `.control-stage`
// under a new React key, and a collapsed accordion auto-opens on selection —
// both change a column's size, which shifts every column after it while
// `window.scrollX` stays numerically fixed. The same offset then frames
// different content, which reads as the page snapping about.
//
// The fix is a classic scroll anchor: measure a persistent element's viewport
// position before the change, and scroll by however far it moved afterwards.
// Measuring happens during render, which still sees the previous commit's DOM;
// the correction runs in a layout effect, before paint, so nothing is drawn at
// the wrong offset.
//
// specs/landscape-layout.md, "Selection must not move the page indirectly".

import { useLayoutEffect, useRef } from "react";
import { isHorizontalDashboard } from "./useClickDragScroll";

// Elements that survive a selection change, so their movement is a true
// measure of how far the row shifted. `.horizontal-accordion` is the important
// one: only the stage attached to it remounts, the section itself persists.
const ANCHOR_SELECTOR = [
  ".dashboard-overview",
  ".zones-panel",
  ".horizontal-accordion",
  ".tasks-stage",
  ".voice-transcript-panel",
].join(",");

type Anchor = { element: Element; position: number; horizontal: boolean };

function leadingEdge(element: Element, horizontal: boolean): number {
  const rect = element.getBoundingClientRect();
  return horizontal ? rect.left : rect.top;
}

/**
 * The persistent element the viewport's leading edge currently sits in — the
 * last one starting at or before the edge, or the first one when the page is
 * scrolled before all of them.
 */
function measureAnchor(): Anchor | null {
  if (typeof document === "undefined") {
    return null;
  }

  const horizontal = isHorizontalDashboard();
  const candidates = Array.from(document.querySelectorAll(ANCHOR_SELECTOR));
  if (candidates.length === 0) {
    return null;
  }

  let chosen = candidates[0];
  let chosenEdge = leadingEdge(chosen, horizontal);

  for (const candidate of candidates) {
    const edge = leadingEdge(candidate, horizontal);
    // Within a couple of pixels of the edge still counts as "at" it, so a
    // column flush with the viewport is preferred over the one before it.
    if (edge <= 2 && edge >= chosenEdge) {
      chosen = candidate;
      chosenEdge = edge;
    }
  }

  return { element: chosen, position: chosenEdge, horizontal };
}

function restoreAnchor(anchor: Anchor) {
  if (!anchor.element.isConnected) {
    return;
  }

  const moved = leadingEdge(anchor.element, anchor.horizontal) - anchor.position;
  if (Math.abs(moved) < 0.5) {
    return;
  }

  // A shift larger than the viewport is content arriving or the layout flipping
  // orientation, not a selection resizing one column. Correcting for that would
  // throw the page somewhere arbitrary, so leave it to useScrollRestore.
  const viewport = anchor.horizontal ? window.innerWidth : window.innerHeight;
  if (Math.abs(moved) > viewport) {
    return;
  }

  window.scrollBy({
    left: anchor.horizontal ? moved : 0,
    top: anchor.horizontal ? 0 : moved,
    behavior: "instant",
  });
}

/**
 * Hold the page still across the layout change `key` describes. Pass a string
 * that changes exactly when the layout is about to change — the selected zone
 * ids, or an accordion's open state.
 */
export function useScrollAnchor(key: string): void {
  const lastKey = useRef(key);
  const pending = useRef<Anchor | null>(null);

  // Render phase: React has not committed yet, so this reads the layout as it
  // stands before the change. The guard keeps a double render (StrictMode, or a
  // re-render before the effect runs) from overwriting the original measurement
  // with one taken after the shift.
  if (key !== lastKey.current && pending.current === null) {
    pending.current = measureAnchor();
  }

  useLayoutEffect(() => {
    lastKey.current = key;
    const anchor = pending.current;
    pending.current = null;
    if (anchor) {
      restoreAnchor(anchor);
    }
  }, [key]);
}
