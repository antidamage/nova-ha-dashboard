"use client";

// Default rendered size in CSS pixels; callers can override via the `size`
// prop (e.g. the 150 px config preview).
export const SIZE = 128;

// The orb's radius as a fraction of the canvas size. Module layers use unit
// space where 1.0 = this radius, so the canvas keeps a small margin for glow
// spill from layers that extend slightly past the rim.
export const ORB_RADIUS_FRACTION = 0.48;

// Load polling cadence. This was 100ms -- ten requests a second, forever, from
// every open dashboard. It bought nothing visually (LOAD_EASE below smooths the
// orb over about a second regardless) and it wedged the kiosk: each response
// holds a shared-memory data pipe until the renderer garbage-collects it, and at
// 10Hz the renderer walked its 1024-descriptor limit in under an hour, after
// which the page froze and the watchdog killed the browser. Keep this well above
// the easing time constant.
export const POLL_MS = 2000;
export const LOAD_EASE = 1.0; // ease toward server-reported load

// While the voice agent speaks, the canvas backing store is rendered at a
// higher resolution so the CSS-scaled centred orb stays crisp.
export const SPEECH_RESOLUTION_BOOST = 2;
// The return migration must outlast the CSS transition (globals.css).
export const SPEECH_RETURN_FALLBACK_MS = 600;
// Horizontal dashboard sidebar: the 200px orb shrinks to half over the first
// 400px of sideways scroll (specs/landscape-layout.md).
export const SIDEBAR_SCROLL_DISTANCE = 400;
export const SIDEBAR_SCALE_MIN = 0.5;

/** How large the speaking orb should be relative to the viewport. */
export function speechScaleFor(viewportWidth: number, viewportHeight: number, size: number) {
  const target = Math.min(viewportWidth, viewportHeight) * 0.45;
  return Math.max(1.3, Math.min(3, target / size));
}

export function percentRatio(value: number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed / 100));
}
