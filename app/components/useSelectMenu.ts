"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Shared plumbing for the stylised `cyber-select` dropdowns.
 *
 * Every one of these menus used to be an `position: absolute` child of its
 * trigger, which meant it was trapped inside whatever stacking context /
 * `overflow: hidden` / `clip-path` its surrounding config card created — so the
 * open list painted *behind* the panel below it. The fix, applied uniformly:
 * render the menu in a portal to <body> with fixed coordinates measured off the
 * trigger, so it always sits above everything and is never clipped.
 *
 * Returns the refs to attach (container = trigger wrapper, used for
 * click-outside; menu = the portalled <ul>), plus the inline style for the
 * menu. `menuStyle` is null until the trigger has been measured; callers render
 * the portal only once it exists.
 */
export function useSelectMenu(open: boolean, setOpen: (open: boolean) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const reposition = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) {
      return;
    }
    const box = trigger.getBoundingClientRect();
    setRect({ left: box.left, top: box.bottom + 6, width: box.width });
  }, []);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    reposition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    // Keep the portalled menu glued to the trigger if anything scrolls/resizes.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition, setOpen]);

  const menuStyle: CSSProperties | null = rect
    ? { left: rect.left, top: rect.top, width: rect.width }
    : null;

  return { containerRef, menuRef, menuStyle, reposition };
}
