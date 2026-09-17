"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { NovaAvatarTheme } from "../theme-model/types";
import NovaAvatar from "../nova-avatar/NovaAvatar";
import { PREVIEW_SCROLL_SCALE_DISTANCE, PREVIEW_SCROLL_SCALE_MIN, PREVIEW_SIZE } from "./constants";

/**
 * The config preview orb. It sits in the layout like any block until its slot
 * reaches the top of the viewport, then stays pinned there and eases smaller,
 * so edits further down the section stay visible. When the end of the section
 * arrives it is pushed up and out with it.
 *
 * The orb is portalled to <body> with `position: fixed` rather than relying on
 * `position: sticky`, which any overflow-clipping or transformed ancestor in
 * the config workspace silently defeats. The slot keeps the layout space; the
 * floating orb tracks it on scroll/resize by direct style writes, so scrolling
 * never re-renders the config form.
 */
export function PinnedOrbPreview({
  sectionRef,
  theme,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  theme: NovaAvatarTheme;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const floatRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const slot = slotRef.current;
    const float = floatRef.current;
    if (!slot || !float) return;
    let raf = 0;
    // --nova-avatar-top is a calc() over env() and max(), which
    // getPropertyValue returns unresolved; a hidden probe sized by it gives the
    // resolved pixels (margin plus the iOS status-bar clearance).
    const topProbe = document.createElement("div");
    topProbe.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:var(--nova-avatar-top);visibility:hidden;pointer-events:none";
    document.body.appendChild(topProbe);
    const update = () => {
      raf = 0;
      const rect = slot.getBoundingClientRect();
      // A collapsed accordion leaves the slot with no box: hide the orb too.
      if (rect.width === 0 && rect.height === 0) {
        float.style.visibility = "hidden";
        return;
      }
      const margin = topProbe.getBoundingClientRect().height || 14;
      const naturalTop = rect.top + (rect.height - PREVIEW_SIZE) / 2;
      const overshoot = Math.max(0, margin - naturalTop);
      const t = Math.min(1, overshoot / PREVIEW_SCROLL_SCALE_DISTANCE);
      const scale = 1 + (PREVIEW_SCROLL_SCALE_MIN - 1) * t;
      let top = Math.max(naturalTop, margin);
      const section = sectionRef.current;
      if (section) {
        top = Math.min(top, section.getBoundingClientRect().bottom - PREVIEW_SIZE * scale);
      }
      float.style.visibility = "visible";
      float.style.left = `${rect.left + rect.width / 2}px`;
      float.style.top = `${top}px`;
      float.style.transform = `translateX(-50%) scale(${scale.toFixed(4)})`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    // Capture phase so an inner scroll container is heard as well as the window.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(slot);
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      topProbe.remove();
    };
  }, [mounted, sectionRef]);

  return (
    <div ref={slotRef} className="nova-avatar-cfg-preview-slot" style={{ height: PREVIEW_SIZE + 16 }}>
      {mounted
        ? createPortal(
            <div
              ref={floatRef}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                zIndex: 1000,
                width: PREVIEW_SIZE,
                height: PREVIEW_SIZE,
                transformOrigin: "top center",
                pointerEvents: "none",
                visibility: "hidden",
              }}
            >
              <NovaAvatar
                size={PREVIEW_SIZE}
                forceVisible
                forceGymAlert
                themeOverride={theme}
                className="nova-avatar-cfg-preview-host"
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
