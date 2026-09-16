"use client";

import { Fragment, useEffect, useState } from "react";
import type { NovaGlassSettings } from "../theme-model/types";
import { glassDisplaceScale, glassImageBlur, glassMapBlur, glassRefractionOpacity } from "./glass-model";
import {
  CONCENTRIC_LENS_LAYER_COUNT,
  buildImageTransformMap,
  buildLensDisplacementMap,
  concentricLayerScale,
} from "./lens-maps-model";

// ---------------------------------------------------------------------------
// Filter definition
// ---------------------------------------------------------------------------

/**
 * The hidden `<svg>` carrying the displacement filter. NovaAvatar references
 * it as `filter: url(#filterId)` on the glass wrapper. Rendered outside that
 * wrapper (a filter def draws nothing itself). Degrades to a pass-through on
 * the server / before the map is generated, so the orb never blanks.
 */
export function NovaOrbGlassFilter({
  filterId,
  glass,
  size,
}: {
  filterId: string;
  glass: NovaGlassSettings;
  size: number;
}) {
  // Map generation requires a browser canvas. Generating in useMemo during
  // SSR leaves the hydrated filter permanently on its no-op fallback, so do
  // it after mount and regenerate whenever the shaping controls change.
  const [lensMaps, setLensMaps] = useState<string[]>([]);
  const [transformMap, setTransformMap] = useState("");
  const transformActive = glass.localStretch !== 0 || glass.flipVertical;
  useEffect(() => {
    setLensMaps(
      Array.from({ length: CONCENTRIC_LENS_LAYER_COUNT }, (_, layerIndex) =>
        buildLensDisplacementMap(
          glass.refractPower,
          layerIndex,
          CONCENTRIC_LENS_LAYER_COUNT,
        ),
      ),
    );
  }, [glass.refractPower]);
  useEffect(() => {
    setTransformMap(
      transformActive ? buildImageTransformMap(glass.localStretch, glass.flipVertical) : "",
    );
  }, [glass.localStretch, glass.flipVertical, transformActive]);
  const scale = glassDisplaceScale(glass);
  const blur = glassMapBlur(glass);
  const imageBlur = glassImageBlur(glass);
  const refractionOpacity = glassRefractionOpacity(glass);

  return (
    <svg className="nova-orb-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        {/* color-interpolation-filters=sRGB keeps 128 as the true neutral so
            the displacement map isn't gamma-shifted into a constant bias. */}
        <filter
          id={filterId}
          x="-10%"
          y="-10%"
          width="120%"
          height="120%"
          colorInterpolationFilters="sRGB"
        >
          {lensMaps.length === CONCENTRIC_LENS_LAYER_COUNT ? (
            <>
              {/* Image transform (localStretch zoom / vertical flip) runs FIRST,
                  reshaping the raw backdrop, and the lens layers then refract that
                  already-transformed image. Order matters: chaining this
                  large-scale (size*2) pass AFTER the lens instead wiped the lens
                  warp back out — Chromium loses the accumulated fine displacement
                  when a much larger displacement is applied on top, so the glass
                  refraction "disappeared" the moment a non-zero localStretch/flip
                  theme loaded. Running it before the lens keeps both. */}
              {transformActive && transformMap ? (
                <>
                  <feImage
                    href={transformMap}
                    x="-10%"
                    y="-10%"
                    width="120%"
                    height="120%"
                    preserveAspectRatio="none"
                    result="imageTransformMap"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="imageTransformMap"
                    scale={size * 2}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="glassBackdropSource"
                  />
                </>
              ) : null}
              {lensMaps.map((lensMap, layerIndex) => {
                const mapId = `lensMap-${layerIndex}`;
                const softMapId = `lensMapSoft-${layerIndex}`;
                const warpId = `lensWarp-${layerIndex}`;
                const baseSource =
                  transformActive && transformMap ? "glassBackdropSource" : "SourceGraphic";
                return (
                  <Fragment key={layerIndex}>
                    <feImage
                      key={`${mapId}-image`}
                      href={lensMap}
                      x="-10%"
                      y="-10%"
                      width="120%"
                      height="120%"
                      preserveAspectRatio="none"
                      result={mapId}
                    />
                    <feGaussianBlur in={mapId} stdDeviation={blur} result={softMapId} />
                    <feDisplacementMap
                      in={layerIndex === 0 ? baseSource : `lensWarp-${layerIndex - 1}`}
                      in2={softMapId}
                      scale={scale * concentricLayerScale(layerIndex)}
                      xChannelSelector="R"
                      yChannelSelector="G"
                      result={warpId}
                    />
                  </Fragment>
                );
              })}
              {/* Frosted-glass blur of the fully-refracted image (the last lens
                  layer's output). Applied last so it softens what you see through
                  the orb, not the displacement maps. Skipped at 0 so the default
                  glass stays crisp. */}
              {imageBlur > 0 ? (
                <feGaussianBlur
                  in={`lensWarp-${CONCENTRIC_LENS_LAYER_COUNT - 1}`}
                  stdDeviation={imageBlur}
                  result="refractedImage"
                />
              ) : null}
              {/* Refraction-group opacity: cross-fade the finished refracted
                  image back toward the plain backdrop. feComponentTransfer scales
                  the refracted layer's alpha, then feMerge composites it over an
                  untouched SourceGraphic — so 1 is full refraction and 0 shows the
                  unbent page. Skipped at full so the default filter output is the
                  refracted image directly. */}
              {refractionOpacity < 1 ? (
                <>
                  <feComponentTransfer
                    in={imageBlur > 0 ? "refractedImage" : `lensWarp-${CONCENTRIC_LENS_LAYER_COUNT - 1}`}
                    result="refractedFaded"
                  >
                    <feFuncA type="linear" slope={refractionOpacity} intercept={0} />
                  </feComponentTransfer>
                  <feMerge>
                    <feMergeNode in="SourceGraphic" />
                    <feMergeNode in="refractedFaded" />
                  </feMerge>
                </>
              ) : null}
            </>
          ) : (
            <feOffset in="SourceGraphic" dx="0" dy="0" />
          )}
        </filter>
      </defs>
    </svg>
  );
}
