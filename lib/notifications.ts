// Facade over lib/notifications/: one-off dashboard notifications.
export { createNotification, dismissAllNotifications, dismissNotification, readNotifications } from "./notifications/store";
export type { DashboardNotification, NotificationSeverity } from "./notifications/types";
