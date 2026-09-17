"use client";

import { useEffect, type RefObject } from "react";
import type maplibregl from "maplibre-gl";

export function useMapViewportFit(
  containerRef: RefObject<HTMLDivElement | null>,
  mapRef: RefObject<maplibregl.Map | null>,
) {
  // Keep the map no taller than the viewport space left below its top edge.
  // The panel's `aspect-ratio` grows the box with its width, so on a wide
  // window the map would otherwise run past the bottom of the screen and force
  // scrolling. We cap the bordered section (our grandparent), which the map
  // fills via h-full; MapLibre re-fits its canvas to the new size.
  useEffect(() => {
    const section = containerRef.current?.parentElement?.parentElement;
    if (!(section instanceof HTMLElement)) {
      return;
    }
    const BOTTOM_GAP_PX = 20;
    const fitToViewport = () => {
      const top = section.getBoundingClientRect().top;
      const available = window.innerHeight - top - BOTTOM_GAP_PX;
      section.style.maxHeight = available > 0 ? `${available}px` : "";
      mapRef.current?.resize();
    };
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => {
      window.removeEventListener("resize", fitToViewport);
      section.style.maxHeight = "";
    };
  }, []);
}
