"use client";

// The page half of the kiosk backlight (specs/kiosk-backlight.md). The kiosk's
// nova-kiosk-backlight service owns the timing and the hardware; this hook
// gives it the current period's settings (Kiosk Display in config), swallows a tap on a panel too dim to read, and
// covers the page in black while the service has the panel blank.
// It is inert unless the service has installed window.novaKioskBacklight, so
// every other device is untouched.

import { useEffect, useRef } from "react";
import { kioskBacklightMessage, type KioskBacklightSettings } from "../../../lib/kiosk-backlight/settings";
import type { SunStatus } from "../../../lib/types";

export const KIOSK_BACKLIGHT_EVENT = "nova:kiosk-backlight";
/** A tap is swallowed this long after the panel stops being dark. */
export const SWALLOW_AFTER_DARK_MS = 500;
/**
 * The service repeats its state every 5 s while dark. Past this with no word, it
 * is gone (stopped, crashed, socket dropped) and its restore has lit the panel,
 * so the page stops swallowing taps. (The cover lifts on the next tap.)
 */
export const DARK_EXPIRES_MS = 15000;
const BINDING_POLL_MS = 2000;
const ACTIVITY_THROTTLE_MS = 1000;
const SWALLOWED_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchstart", "touchend"];

export type KioskBacklightState = {
  phase?: string;
  level?: number;
  target?: number;
  dim?: number;
  off?: boolean;
  dark?: boolean;
  blank?: boolean;
  woke?: boolean;
};

type BacklightWindow = Window & {
  novaKioskBacklight?: (payload: string) => void;
  __novaKioskBacklight?: KioskBacklightState;
};

function bridge(): ((payload: string) => void) | null {
  const call = (window as BacklightWindow).novaKioskBacklight;
  return typeof call === "function" ? call : null;
}

function send(message: Record<string, unknown>): boolean {
  const call = bridge();
  if (!call) return false;
  try {
    call(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/**
 * The blank phase's cover: solid black over everything. Not a theme colour: it
 * stands in for a powered-off panel, whose touch layer this hardware loses. It
 * takes no input; the window-level swallow holds the tap and lifts it.
 */
function createCover(): HTMLDivElement {
  const cover = document.createElement("div");
  cover.dataset.kioskBacklightCover = "";
  cover.setAttribute("aria-hidden", "true");
  Object.assign(cover.style, {
    position: "fixed",
    inset: "0",
    background: "#000",
    zIndex: "2147483647",
    pointerEvents: "none",
    display: "none",
  });
  document.body.appendChild(cover);
  return cover;
}

type BacklightMessage = ReturnType<typeof kioskBacklightMessage>;

function sendTarget(message: BacklightMessage | null) {
  // Nothing until the dashboard state has loaded: a guess would be daylight,
  // and 100% at 3am is the glow this exists to remove.
  if (message !== null) send(message);
}

function disagrees(state: KioskBacklightState, message: BacklightMessage | null) {
  if (!message || typeof state.target !== "number") return false;
  if (state.target !== message.target) return true;
  // An older service reports no dim or off; it is not asked again for those.
  if (typeof state.dim === "number" && state.dim !== message.dim) return true;
  return typeof state.off === "boolean" && state.off !== message.off;
}

export function useKioskBacklight(sun: SunStatus | null | undefined, settings?: KioskBacklightSettings | null) {
  const message = sun ? kioskBacklightMessage(settings, sun) : null;
  const key = message ? `${message.target}/${message.dim}/${message.off}` : "";
  const targetRef = useRef(message);
  targetRef.current = message;

  // The settings: on the binding appearing, on a sun or settings change, on a
  // wake and on any disagreement with what the service holds.
  useEffect(() => {
    sendTarget(targetRef.current);
  }, [key]);

  useEffect(() => {
    let dark = false;
    let darkHeardAt = 0;
    let swallowUntil = 0;
    let attached = false;
    let lastActivity = 0;
    const cover = createCover();
    const showCover = (show: boolean) => {
      cover.style.display = show ? "block" : "none";
    };

    const apply = (state: KioskBacklightState | undefined) => {
      if (!state) return;
      showCover(state.blank === true);
      if (state.dark) {
        dark = true;
        darkHeardAt = Date.now();
      } else if (dark) {
        dark = false;
        swallowUntil = Date.now() + SWALLOW_AFTER_DARK_MS;
      }
      if (state.woke || disagrees(state, targetRef.current)) {
        sendTarget(targetRef.current);
      }
    };

    const onState = (event: Event) => apply((event as CustomEvent<KioskBacklightState>).detail);
    const swallow = (event: Event) => {
      // Any tap lifts the cover in the page itself, so a service that died while
      // blank cannot leave a black screen behind.
      if (event.type === "pointerdown" || event.type === "touchstart") showCover(false);
      if (dark && Date.now() - darkHeardAt > DARK_EXPIRES_MS) dark = false;
      if (!attached || !(dark || Date.now() < swallowUntil)) return;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const activity = () => {
      const now = Date.now();
      if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
      lastActivity = now;
      send({ activity: true });
    };
    const findBinding = () => {
      if (attached || !bridge()) return;
      attached = true;
      apply((window as BacklightWindow).__novaKioskBacklight);
      sendTarget(targetRef.current);
    };

    window.addEventListener(KIOSK_BACKLIGHT_EVENT, onState);
    // Activity first: the swallow stops later listeners, and a mouse-only kiosk
    // still has to wake from its swallowed click.
    window.addEventListener("pointerdown", activity, { capture: true, passive: true });
    window.addEventListener("keydown", activity, { capture: true, passive: true });
    for (const name of SWALLOWED_EVENTS) {
      window.addEventListener(name, swallow, { capture: true, passive: false });
    }
    window.addEventListener(KIOSK_BACKLIGHT_EVENT, findBinding);
    findBinding();
    const poll = window.setInterval(findBinding, BINDING_POLL_MS);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener(KIOSK_BACKLIGHT_EVENT, onState);
      window.removeEventListener(KIOSK_BACKLIGHT_EVENT, findBinding);
      for (const name of SWALLOWED_EVENTS) {
        window.removeEventListener(name, swallow, { capture: true });
      }
      window.removeEventListener("pointerdown", activity, { capture: true });
      window.removeEventListener("keydown", activity, { capture: true });
      cover.remove();
    };
  }, []);
}
