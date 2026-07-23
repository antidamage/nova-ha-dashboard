"use client";

// External interaction-priority signal. High-frequency producers use it to
// coalesce work while the viewport is moving, then apply only their newest
// value after scrolling settles.
const CHANGE_EVENT = "nova-page-update-pause-change";

let paused = false;

export function arePageUpdatesPaused(): boolean {
  return paused;
}

export function setPageUpdatesPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute("data-nova-scroll-active", next);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { paused: next } }));
  }
}

export function subscribePageUpdatePause(listener: (paused: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = () => listener(paused);
  window.addEventListener(CHANGE_EVENT, handle);
  return () => window.removeEventListener(CHANGE_EVENT, handle);
}
