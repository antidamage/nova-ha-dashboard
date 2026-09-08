"use client";

import { useEffect, useRef } from "react";

/**
 * Tells the face service that somebody is still here.
 *
 * A `quick` or `image` sign-in traded the liveness and anti-spoof gates away
 * for a one-second capture, and what it got back is a session that ends after
 * 15 minutes of inactivity. The service has no way to observe that on its own —
 * nothing about using the dashboard reaches it — so the page reports.
 *
 * **This extends a session; it cannot create or keep one by itself.** The
 * timeout is enforced server-side in the face service's sweep, so a tab that is
 * closed, a browser that is killed, a laptop that sleeps, and a client that
 * simply stops calling all reach the same end. Nothing here is load-bearing for
 * security: withholding the heartbeat only signs you out sooner.
 *
 * Activity means a real input event — pointer, key, touch — not the page merely
 * being open. A dashboard left on a wall display is not activity, and that is
 * the case the timeout exists for.
 *
 * See `specs/login-surface.md` § What bounds it instead.
 */

/** How often a heartbeat may be sent at most. */
const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Back-off once the service says there is nothing to touch.
 *
 * A password or `standard` face session answers `{touched: 0}` forever, and
 * there is no reason to ask it every minute for the life of the tab. It is
 * still asked occasionally rather than never, because a quick sign-in can
 * happen later in the same tab — that is exactly what the config-page modal is.
 */
const IDLE_POLL_INTERVAL_MS = 5 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function useActivityHeartbeat(): void {
  const lastActivity = useRef(0);
  const lastSent = useRef(0);
  const hasQuickSession = useRef(true);

  useEffect(() => {
    let live = true;
    const note = () => {
      lastActivity.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, note, { passive: true });
    }
    // Coming back to a hidden tab is activity in its own right: the person
    // returned to it, which is the thing being measured.
    const onVisible = () => {
      if (document.visibilityState === "visible") note();
    };
    document.addEventListener("visibilitychange", onVisible);
    note();

    const tick = async () => {
      if (!live) return;
      const now = Date.now();
      const interval = hasQuickSession.current ? HEARTBEAT_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
      // Nothing to report: no input since the last heartbeat. Staying quiet is
      // the correct behaviour, not a missed beat — it is how the timeout fires
      // for somebody who walked away with the tab open.
      if (now - lastSent.current < interval || lastActivity.current <= lastSent.current) return;
      lastSent.current = now;
      try {
        const response = await fetch("/api/face/activity", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!live) return;
        if (response.ok) {
          const body = (await response.json()) as { touched?: number };
          hasQuickSession.current = (body.touched ?? 0) > 0;
        }
      } catch {
        // A failed heartbeat is not worth surfacing. The worst case is an
        // earlier sign-out, and a login modal is one click away.
      }
    };

    const timer = window.setInterval(() => void tick(), 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, note);
      }
    };
  }, []);
}
