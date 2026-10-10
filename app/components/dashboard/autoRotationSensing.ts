"use client";

// Does this device rotate its own display? If it does, the OS already turns the
// page and a manual rotate button would fight it (specs/kiosk-display-rotation.md).
//
// The OS auto-rotate flag (Android / iOS rotation lock) is not exposed to web
// pages by any browser, so it cannot be consulted: a phone with rotation locked
// still has the sensor, and is treated as self-rotating.

import { useEffect, useState } from "react";

export const SENSOR_PROBE_MS = 1500;

type NavigatorLike = {
  maxTouchPoints?: number;
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
};

/** Rules 1-3: what the user agent says. Synchronous. */
export function isSelfRotatingByAgent(nav: NavigatorLike): boolean {
  if (nav.userAgentData?.mobile === true) return true;
  const agent = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod|Android/i.test(agent)) return true;
  // iPadOS asks for desktop sites by default and reports as a Mac, but a Mac
  // has no multi-touch screen.
  return /Macintosh/.test(agent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Rule 4: a real accelerometer reports numbers, a desktop browser reports nulls. */
export function isSensorReading(event: Pick<DeviceOrientationEvent, "beta" | "gamma">): boolean {
  return typeof event.beta === "number" || typeof event.gamma === "number";
}

export function useAutoRotatingDevice(): boolean {
  // False on the server and first client render so hydration matches.
  const [selfRotating, setSelfRotating] = useState(false);

  useEffect(() => {
    if (isSelfRotatingByAgent(navigator)) {
      setSelfRotating(true);
      return;
    }
    if (typeof window.DeviceOrientationEvent === "undefined") return;

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (isSensorReading(event)) setSelfRotating(true);
    };
    window.addEventListener("deviceorientation", onOrientation);
    const stop = window.setTimeout(
      () => window.removeEventListener("deviceorientation", onOrientation),
      SENSOR_PROBE_MS,
    );
    return () => {
      window.clearTimeout(stop);
      window.removeEventListener("deviceorientation", onOrientation);
    };
  }, []);

  return selfRotating;
}
