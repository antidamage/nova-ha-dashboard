export const NOTIFICATION_SEVERITIES = ["info", "success", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * A one-off message shown on every dashboard screen until it is dismissed or
 * expires. Not a reminder or task: it has no schedule, no repeat and no
 * completion, and it never appears in the Reminders panel.
 */
export type DashboardNotification = {
  id: string;
  title: string;
  body?: string;
  severity: NotificationSeverity;
  /** Who raised it, e.g. "claude-code". Shown small under the title. */
  source?: string;
  createdAt: string;
  /** ISO instant after which the notification is dropped; null = until dismissed. */
  expiresAt: string | null;
};

export type NotificationFile = { notifications: DashboardNotification[] };
