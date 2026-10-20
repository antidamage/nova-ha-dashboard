"use client";

import { X } from "lucide-react";
import type { NotificationSeverity } from "../../../lib/notifications";
import { useNotifications } from "./useNotifications";

const SEVERITY_BORDER: Record<NotificationSeverity, string> = {
  info: "border-cyan-300/60",
  success: "border-emerald-400/70",
  warning: "border-amber-400/80",
  critical: "border-red-500/90",
};

/**
 * One-off notifications raised through POST /api/notifications (see
 * specs/notifications.md). Stacked top-right on every screen; tap the X to
 * dismiss it everywhere. Plain markup, no animation or canvas, so it is the
 * same in rich and lite experience modes.
 */
export function NotificationStack() {
  const { dismiss, notifications } = useNotifications();
  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="nova-notification-stack fixed right-5 top-5 z-[60] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2"
    >
      {notifications.map((entry) => (
        <div
          className={`nova-notification border bg-neutral-950 px-4 py-3 text-sm text-cyan-50 shadow-2xl ${SEVERITY_BORDER[entry.severity]}`}
          data-severity={entry.severity}
          key={entry.id}
          role={entry.severity === "critical" ? "alert" : "status"}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-black uppercase">{entry.title}</p>
            <button aria-label="Dismiss notification" className="shrink-0 opacity-70" onClick={() => dismiss(entry.id)} type="button">
              <X size={16} />
            </button>
          </div>
          {entry.body ? <p className="mt-1 whitespace-pre-wrap">{entry.body}</p> : null}
          {entry.source ? <p className="mt-1 text-xs opacity-60">{entry.source}</p> : null}
        </div>
      ))}
    </div>
  );
}
