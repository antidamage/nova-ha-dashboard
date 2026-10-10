"use client";

// Which way the kiosk's display is turned, as the kiosk's rotation service
// reports it (ops/kiosk/nova-kiosk-rotate.py sets window.__novaKioskRotation and
// fires nova:kiosk-rotation). Null on a machine without the service.
// specs/kiosk-display-rotation.md.

import { useEffect, useState } from "react";

export const KIOSK_ROTATION_EVENT_NAME = "nova:kiosk-rotation";

/** Clockwise order of the picture's turns: each step is one tap of the button. */
export const ROTATION_CYCLE = ["normal", "left", "inverted", "right"] as const;
export type KioskRotation = (typeof ROTATION_CYCLE)[number];

export function asKioskRotation(value: unknown): KioskRotation | null {
  return ROTATION_CYCLE.find((name) => name === value) ?? null;
}

/** Clockwise quarter-turns (0-3) the picture made going from one rotation to the other. */
export function rotationSteps(from: KioskRotation, to: KioskRotation): number {
  return (ROTATION_CYCLE.indexOf(to) - ROTATION_CYCLE.indexOf(from) + 4) % 4;
}

export function readKioskRotation(): KioskRotation | null {
  if (typeof window === "undefined") return null;
  return asKioskRotation((window as { __novaKioskRotation?: unknown }).__novaKioskRotation);
}

export function useKioskRotation(): KioskRotation | null {
  // Null on the server and first client render so hydration matches.
  const [rotation, setRotation] = useState<KioskRotation | null>(null);

  useEffect(() => {
    const sync = () => setRotation(readKioskRotation());
    sync();
    window.addEventListener(KIOSK_ROTATION_EVENT_NAME, sync);
    return () => window.removeEventListener(KIOSK_ROTATION_EVENT_NAME, sync);
  }, []);

  return rotation;
}
