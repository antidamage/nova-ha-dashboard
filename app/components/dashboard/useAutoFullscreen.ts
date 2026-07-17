"use client";

import { useCallback, useEffect, useRef } from "react";
import { requestDashboardFullscreen } from "./shell";

const AUTO_FULLSCREEN_CHECK_INTERVAL_MS = 60 * 1000;

const WINDOW_FULLSCREEN_CHECK_EVENTS = [
  "focus",
  "online",
  "orientationchange",
  "pageshow",
  "resize",
] as const;

const DOCUMENT_FULLSCREEN_CHECK_EVENTS = [
  "MSFullscreenChange",
  "fullscreenchange",
  "mozfullscreenchange",
  "visibilitychange",
  "webkitfullscreenchange",
] as const;

const TRUSTED_FULLSCREEN_CHECK_EVENTS = [
  "auxclick",
  "click",
  "dblclick",
  "keydown",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchend",
] as const;

const CAPTURE_EVENT_OPTIONS = { capture: true };

export function useAutoFullscreen(enabled: boolean) {
  const requestInFlight = useRef(false);

  const checkFullscreen = useCallback(async () => {
    if (!enabled || requestInFlight.current) {
      return;
    }

    if (document.visibilityState === "hidden") {
      return;
    }

    requestInFlight.current = true;
    try {
      await requestDashboardFullscreen();
    } finally {
      requestInFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onCheck = () => {
      void checkFullscreen();
    };

    onCheck();
    WINDOW_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => window.addEventListener(eventName, onCheck));
    DOCUMENT_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => document.addEventListener(eventName, onCheck));
    TRUSTED_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => document.addEventListener(eventName, onCheck, CAPTURE_EVENT_OPTIONS));

    const interval = window.setInterval(onCheck, AUTO_FULLSCREEN_CHECK_INTERVAL_MS);

    return () => {
      WINDOW_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => window.removeEventListener(eventName, onCheck));
      DOCUMENT_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => document.removeEventListener(eventName, onCheck));
      TRUSTED_FULLSCREEN_CHECK_EVENTS.forEach((eventName) => document.removeEventListener(eventName, onCheck, CAPTURE_EVENT_OPTIONS));
      window.clearInterval(interval);
    };
  }, [checkFullscreen, enabled]);
}
