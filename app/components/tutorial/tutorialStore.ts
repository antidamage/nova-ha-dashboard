"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the tour is open. Nothing about it persists: a reload always starts
 * outside it (specs/tutorial-mode.md, "Opening and closing it").
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openTutorial() {
  if (open) return;
  open = true;
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
