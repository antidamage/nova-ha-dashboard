"use client";

// Sole owner of the glass package's animation loop (the reflection drift).

import { type CSSProperties, type RefObject, useEffect, useRef } from "react";
import type { NovaGlassSettings } from "../theme-model/types";
import { clamp, glassDriftPx, pctTo } from "./glass-model";

// ---------------------------------------------------------------------------
// Reflection + gloss layers
// ---------------------------------------------------------------------------

/**
 * The two blend-mode layers that go INSIDE the glass wrapper, over the canvas:
 * the panning silver-room reflection and the fixed gloss highlight. Owns the
 * drift animation that slides the reflection as the orb moves on the page or
 * the pointer sweeps across it.
 *
 * `active` gates the drift loop (parent turns it off when the orb is hidden,
 * in lite mode, or the reflection is dialled to nothing); reduced-motion is
 * honoured here directly.
 */
export function NovaOrbGlassLayers({
  glass,
  hostRef,
  active,
}: {
  glass: NovaGlassSettings;
  hostRef: RefObject<HTMLElement | null>;
  active: boolean;
}) {
  const reflectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = reflectionRef.current;
    const host = hostRef.current;
    if (!el || !host || !active) {
      el?.style.setProperty("--nova-orb-refl-x", "0px");
      el?.style.setProperty("--nova-orb-refl-y", "0px");
      return;
    }
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const amp = glassDriftPx(glass);
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerAt = 0;
    let raf = 0;
    let prevCenterX = Number.NaN;
    let prevCenterY = Number.NaN;

    const step = () => {
      const rect = host.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // How far the orb sits from the viewport centre — makes the reflection
      // sweep as the orb migrates (e.g. the speech fly-to-centre) or scales.
      const posX = (centerX - vw / 2) / (vw / 2);
      const posY = (centerY - vh / 2) / (vh / 2);

      // The pointer acts as a moving light: the reflection leans toward it.
      const pointerLive = performance.now() - pointerAt < 1400;
      const ptrX = pointerLive ? (pointerX - centerX) / (vw / 2) : 0;
      const ptrY = pointerLive ? (pointerY - centerY) / (vh / 2) : 0;

      targetX = clamp(posX * 0.55 + ptrX * 0.85, -1, 1) * amp;
      targetY = clamp(posY * 0.55 + ptrY * 0.85, -1, 1) * amp;

      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;
      el.style.setProperty("--nova-orb-refl-x", `${curX.toFixed(2)}px`);
      el.style.setProperty("--nova-orb-refl-y", `${curY.toFixed(2)}px`);

      const moving =
        Number.isNaN(prevCenterX) ||
        Math.abs(centerX - prevCenterX) > 0.1 ||
        Math.abs(centerY - prevCenterY) > 0.1;
      prevCenterX = centerX;
      prevCenterY = centerY;

      const settling = Math.abs(targetX - curX) > 0.05 || Math.abs(targetY - curY) > 0.05;
      raf = settling || moving || pointerLive ? requestAnimationFrame(step) : 0;
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerAt = performance.now();
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The speech migration is a CSS transform transition on the host — no
    // scroll/pointer event fires, so kick the loop when it starts and let the
    // `moving` guard keep it alive for the whole journey.
    host.addEventListener("transitionrun", schedule);
    host.addEventListener("transitionend", schedule);
    schedule();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      host.removeEventListener("transitionrun", schedule);
      host.removeEventListener("transitionend", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [glass, hostRef, active]);

  const reflectionStyle = {
    opacity: pctTo(glass.reflection, 0, 0.9),
  } as CSSProperties;
  const glossStyle = {
    opacity: pctTo(glass.gloss, 0, 0.9),
  } as CSSProperties;

  return (
    <>
      <div className="nova-orb-reflection" aria-hidden="true" ref={reflectionRef} style={reflectionStyle}>
        <div className="nova-orb-reflection-room" />
      </div>
      <div className="nova-orb-gloss" aria-hidden="true" style={glossStyle} />
    </>
  );
}
