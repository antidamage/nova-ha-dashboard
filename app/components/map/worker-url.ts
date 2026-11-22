"use client";

import * as maplibregl from "maplibre-gl";

/**
 * MapLibre 6 starts its worker from `new URL("./maplibre-gl-worker.mjs",
 * import.meta.url)`, which inside a Next chunk points at a file that does not
 * exist: the worker 404s and no vector tile (buildings, roads, labels) is ever
 * drawn (specs/outside-weather-and-map.md). next.config.ts copies the worker to
 * public/vendor/, and this points MapLibre at it, under the demo's base path.
 */
let pointed = false;

export function pointMapWorkerAtVendorCopy() {
  if (pointed || typeof window === "undefined") return;
  pointed = true;
  const basePath = process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH?.trim() ?? "";
  const url = new URL(`${basePath}/vendor/maplibre-gl-worker.mjs`, window.location.origin);
  url.searchParams.set("v", maplibregl.getVersion());
  maplibregl.setWorkerUrl(url.href);
}
