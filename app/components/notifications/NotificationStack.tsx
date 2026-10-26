"use client";

import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { useNotifications } from "./useNotifications";

/**
 * One-off notifications raised through POST /api/notifications (see
 * specs/notifications.md), drawn with the reminder alert banner's own classes
 * (`task-alert-banner`, `task-alert-title`; app/styles/tasks/task-alerts.css)
 * and stacked on every screen. Tap a banner to dismiss it everywhere; with two
 * or more showing, "Clear all" dismisses every one this screen is showing.
 * Both keep the banner class on the tapped element so the reminder alert's
 * capture-phase tap swallow (useTaskAlerts) lets the tap through. Plain markup,
 * no glow or animation, so it is the same in rich and lite experience modes.
 */
export function NotificationStack() {
  const { dismiss, dismissMany, notifications } = useNotifications();
  if (notifications.length === 0) return null;

  return (
    <div className="task-alert-stack">
      {notifications.length >= 2 ? (
        <MomentaryFeedbackButton
          aria-label="Clear all notifications"
          className="task-alert-banner task-alert-clear-all"
          onClick={() => dismissMany(notifications.map((entry) => entry.id))}
          type="button"
        >
          Clear all ({notifications.length})
        </MomentaryFeedbackButton>
      ) : null}
      {notifications.map((entry) => {
        const meta = [entry.severity === "info" ? null : entry.severity, entry.source].filter(Boolean).join(" · ");
        return (
          <div key={entry.id} role={entry.severity === "critical" ? "alert" : "status"}>
            <button
              aria-label={`Dismiss ${entry.title} notification`}
              className="task-alert-banner"
              data-severity={entry.severity}
              onClick={() => dismiss(entry.id)}
              type="button"
            >
              <span className="task-alert-title">{entry.title}</span>
              {entry.body ? <span className="task-alert-body">{entry.body}</span> : null}
              {meta ? <span className="task-alert-meta">{meta}</span> : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
