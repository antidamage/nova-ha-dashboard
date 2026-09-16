"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY, QUICK_TEMPERATURE_SIZE, quickDialSizeFor } from "./dial-model";

/**
 * Portrait shrinks all three dials together when the card is narrower than one
 * slot, so no ring runs off the screen. Landscape keeps the fixed size: its
 * layout does not use the slot.
 */
export function useQuickDialSize(rowRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState(QUICK_TEMPERATURE_SIZE);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setSize(portrait.matches ? quickDialSizeFor(row.clientWidth) : QUICK_TEMPERATURE_SIZE);
    const observer = new ResizeObserver(update);
    observer.observe(row);
    portrait.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", update);
    };
  }, [rowRef]);
  return size;
}
