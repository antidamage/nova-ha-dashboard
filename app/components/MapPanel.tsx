"use client";

/**
 * World map panel — facade. Lazily loaded by dashboard/panel-registry.tsx and
 * dashboard/useRadarPreload.ts, so it re-exports only the component and
 * MapLibre stays out of the initial bundle (specs/agent-token-footprint.md §3.3).
 *
 *   map/MapPanel.tsx          the component: map lifecycle, input handling
 *   map/useMapViewportFit.ts  caps the panel to the viewport height
 *   map/map-style.ts          initial MapLibre style, home marker element
 *   map/apply-theme.ts        re-applies theme colours to a live map
 *   map/css-theme-model.ts    --cyber-map-* readers, tile URL templates
 *   map/expression-model.ts   paint/layout expressions
 *   map/interaction-model.ts  wheel/pan/rotate maths
 *   map/client.ts             configured map centre
 *   map/store.ts              SOLE state owner: per-map tile-template caches
 *   map/constants.ts, map/types.ts
 */
export { MapPanel } from "./map/MapPanel";
