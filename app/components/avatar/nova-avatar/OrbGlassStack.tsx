"use client";

import { type CSSProperties, type RefObject } from "react";
import { NovaOrbGlassBackdropCopy } from "../orb-glass/NovaOrbGlassBackdropCopy";
import { NovaOrbGlassFilter } from "../orb-glass/NovaOrbGlassFilter";
import { NovaOrbGlassLayers } from "../orb-glass/NovaOrbGlassLayers";
import { glassBoxShadow, glassCanvasMask, glassCanvasOpacity, glassCssBackdropFilter } from "../orb-glass/glass-model";
import type { NovaGlassSettings } from "../theme-model/types";

/** The glass disc, the orb canvas and the SVG lens filter, in paint order. */
export function OrbGlassStack({
  glass,
  glassEnabled,
  svgBackdrop,
  glassFilterId,
  glassDriftActive,
  hostRef,
  canvasRef,
  size,
}: {
  glass: NovaGlassSettings;
  glassEnabled: boolean;
  svgBackdrop: boolean;
  glassFilterId: string;
  glassDriftActive: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  size: number;
}) {
  // The refraction is a backdrop-filter on the glass disc; a `filter` on any
  // ancestor would silently disable it, so the cast shadow lives on the disc
  // as a box-shadow (see NovaOrbGlass.glassBoxShadow) and the host carries no
  // filter. The disc sits BEHIND the canvas and in front of the voice glow.
  const glassBackdropValue = svgBackdrop
    ? `url(#${glassFilterId})`
    : glassCssBackdropFilter(glass);
  const glassDiscStyle = glassEnabled
    ? ({
        backdropFilter: glassBackdropValue,
        WebkitBackdropFilter: glassBackdropValue,
        boxShadow: glassBoxShadow(glass),
      } as CSSProperties)
    : undefined;
  const glassCanvasMaskValue = glassEnabled ? glassCanvasMask(glass) : undefined;
  const canvasStyle = {
    width: size,
    height: size,
    ...(glassEnabled
      ? {
          opacity: glassCanvasOpacity(glass),
          ...(glassCanvasMaskValue
            ? { maskImage: glassCanvasMaskValue, WebkitMaskImage: glassCanvasMaskValue }
            : {}),
        }
      : {}),
  } as CSSProperties;
  return (
    <>
      {/* Liquid glass sits BEHIND the orb canvas and in front of the voice
          glow: a clear disc whose backdrop-filter refracts the page behind the
          whole orb, with the silver-room reflection + gloss fading in from the
          rim. The canvas (below) is dialled clear toward its centre so the
          refraction reads through the middle; the gym counter stays on top and
          sharp. */}
      {glassEnabled ? (
        <div className="nova-orb-glass" style={glassDiscStyle} aria-hidden="true">
          {/* WebKit/iOS can't refract the live backdrop (url() backdrop-filter
              is a no-op there), so it gets a self-contained copy of the page
              backdrop run through the SAME lens filter as a regular filter:.
              The disc still carries the CSS-function frost above; the copy adds
              the actual displacement refraction on top of it. */}
          {!svgBackdrop ? (
            <NovaOrbGlassBackdropCopy filterId={glassFilterId} glass={glass} />
          ) : null}
          <NovaOrbGlassLayers glass={glass} hostRef={hostRef} active={glassDriftActive} />
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="nova-avatar-canvas"
        style={canvasStyle}
      />
      {/* The SVG lens filter is used by BOTH paths: Chromium references it from
          `backdrop-filter: url()` on the disc; WebKit/iOS references it as a
          regular `filter:` on the backdrop copy above. So mount it whenever the
          glass is on. */}
      {glassEnabled ? <NovaOrbGlassFilter filterId={glassFilterId} glass={glass} size={size} /> : null}
    </>
  );
}
