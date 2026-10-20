"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardNotification } from "../../../lib/notifications";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";

function parse<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

/**
 * Live list of one-off notifications: the snapshot sent when the shared event
 * stream connects, then `notification` / `notification-dismiss` pushes. Expiry
 * is also applied locally so a screen does not depend on a server push to
 * drop a timed-out entry.
 */
export function useNotifications() {
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return subscribeToDashboardEvents({
      notifications: (event) => {
        const payload = parse<{ notifications?: DashboardNotification[] }>(event);
        if (payload?.notifications) setNotifications(payload.notifications);
      },
      notification: (event) => {
        const incoming = parse<DashboardNotification>(event);
        if (!incoming?.id) return;
        setNotifications((current) => [...current.filter((entry) => entry.id !== incoming.id), incoming]);
      },
      "notification-dismiss": (event) => {
        const payload = parse<{ id?: string }>(event);
        if (payload?.id) setNotifications((current) => current.filter((entry) => entry.id !== payload.id));
      },
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((entry) => entry.id !== id));
    void fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {
      // The server drops it at expiry regardless; a failed dismiss only means
      // other screens keep it until then.
    });
  }, []);

  const visible = notifications.filter(
    (entry) => entry.expiresAt === null || Date.parse(entry.expiresAt) > nowMs,
  );
  return { dismiss, notifications: visible };
}
