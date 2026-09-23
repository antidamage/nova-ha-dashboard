"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pins the config page's breadcrumb trail.
 *
 * While the page is at rest the trail sits in its own row in the page column —
 * its default position, directly under the category menu. Once the page has
 * scrolled far enough that the row's top reaches the fixed icon cluster's line,
 * the trail picks up: the header band's copy takes over at that line (in front of
 * the theme's orb-shadow strip, because the band is a direct child of the shell
 * rather than of the page column's own `z-index: 1` stacking context), and the
 * resting copy goes invisible while keeping the row's height, so nothing below it
 * moves by a pixel.
 *
 * `data-nova-trail` on the shell is that switch; CSS decides what each state
 * shows. specs/config-page-header.md.
 */
export function useConfigBreadcrumbPin(slotRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const slot = slotRef.current;
    const shell = slot?.closest(".dashboard-shell");
    if (!slot || !shell) {
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      // The cluster's own line, measured rather than assumed: its `top` carries
      // the device's status-bar clearance, which is exactly what the pinned copy
      // uses, so at the threshold the two copies are level and the handover has
      // nothing to see.
      const clusterTop = document.querySelector(".dashboard-reload-link")?.getBoundingClientRect().top;
      const pinned = clusterTop !== undefined && slot.getBoundingClientRect().top <= clusterTop;
      shell.setAttribute("data-nova-trail", pinned ? "pinned" : "resting");
    };
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The update banner above the trail mounts from a fetch after the first paint,
    // which moves this row without any scroll — so watch the column for layout
    // changes as well, or the switch would lag until the next scroll.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(slot.parentElement ?? slot);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      shell.removeAttribute("data-nova-trail");
    };
  }, [slotRef]);
}
