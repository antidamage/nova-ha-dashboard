"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { rowCapacity } from "./cluster-model";

/**
 * How many reminder tiles fit in one row of the bar right now, measured from the
 * element the tiles sit in and the size of a rendered tile. Re-measured when the
 * row resizes or the tile count changes. Null until a tile has been measured.
 */
export function useRowCapacity(barRef: RefObject<HTMLElement | null>, tileCount: number, reserved: number) {
  const [capacity, setCapacity] = useState<number | null>(null);

  const measure = useCallback(() => {
    const tile = barRef.current?.querySelector<HTMLElement>(".reminder-tile");
    const row = tile?.parentElement;
    if (!tile || !row) return;
    const style = getComputedStyle(row);
    const inner = row.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
    const gap = parseFloat(style.columnGap || "0") || 0;
    const fit = rowCapacity(inner, tile.getBoundingClientRect().width, gap);
    setCapacity(fit === null ? null : Math.max(1, fit - reserved));
  }, [barRef, reserved]);

  useLayoutEffect(() => {
    measure();
    const row = barRef.current?.querySelector<HTMLElement>(".reminder-tile")?.parentElement;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [barRef, measure, tileCount]);

  return capacity;
}
