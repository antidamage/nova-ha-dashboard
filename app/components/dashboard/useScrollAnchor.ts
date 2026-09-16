"use client";

// Adeline, 2026-09-16: disabled. This used to measure a persistent element's
// viewport position before a zone/sub-zone/system heading selection changed a
// column's size, then scroll the page to compensate. She experienced that
// compensation as the page jumping to "some determined position" on click and
// asked for it to stop -- the scroll position should just stay where it was,
// pixel for pixel. Kept as a no-op (rather than deleted) so the call sites in
// Dashboard.tsx and HorizontalAccordion.tsx, and the reasoning in
// specs/landscape-layout.md, don't need to change.
export function useScrollAnchor(_key: string): void {}
