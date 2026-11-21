"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the tour is open. Nothing about it persists: a reload always starts
 * outside it (specs/tutorial-mode.md, "Opening and closing it").
 */
let open = false;
// Set when someone has just had to choose an experience mode: the "?" then
// reads "Quick-start tutorial" until the tour is opened or the page reloads
// (alex, 2026-11-21).
let quickStart = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openTutorial() {
  if (open) return;
  open = true;
  quickStart = false;
  emit();
}

export function closeTutorial() {
  if (!open) return;
  open = false;
  emit();
}

export function isTutorialOpen() {
  return open;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTutorialOpen() {
  return useSyncExternalStore(subscribe, isTutorialOpen, () => false);
}

export function offerQuickStart() {
  if (quickStart) return;
  quickStart = true;
  emit();
}

function isQuickStart() {
  return quickStart;
}

export function useQuickStart() {
  return useSyncExternalStore(subscribe, isQuickStart, () => false);
}
