import { randomUUID } from "crypto";
import {
  NOTIFICATION_SEVERITIES,
  type DashboardNotification,
  type NotificationSeverity,
} from "./types";

export const DEFAULT_TTL_SECONDS = 3600;
export const MAX_TTL_SECONDS = 7 * 24 * 3600;
export const MAX_ACTIVE_NOTIFICATIONS = 50;
export const TITLE_MAX = 120;
export const BODY_MAX = 500;
export const SOURCE_MAX = 40;

export type NotificationInputResult =
  | { ok: true; notification: DashboardNotification }
  | { ok: false; error: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validate a create request and build the stored notification. */
export function notificationFromInput(input: unknown, now = Date.now()): NotificationInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;

  const title = text(body.title);
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > TITLE_MAX) return { ok: false, error: `title is limited to ${TITLE_MAX} characters` };

  const message = text(body.body);
  if (message.length > BODY_MAX) return { ok: false, error: `body is limited to ${BODY_MAX} characters` };

  const source = text(body.source);
  if (source.length > SOURCE_MAX) return { ok: false, error: `source is limited to ${SOURCE_MAX} characters` };

  const severity = (body.severity ?? "info") as NotificationSeverity;
  if (!NOTIFICATION_SEVERITIES.includes(severity)) {
    return { ok: false, error: `severity must be one of ${NOTIFICATION_SEVERITIES.join(", ")}` };
  }

  let expiresAt: string | null;
  if (body.sticky === true) {
    expiresAt = null;
  } else {
    const ttl = body.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : Number(body.ttlSeconds);
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
      return { ok: false, error: `ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}` };
    }
    expiresAt = new Date(now + Math.round(ttl) * 1000).toISOString();
  }

  return {
    ok: true,
    notification: {
      id: randomUUID(),
      title,
      ...(message ? { body: message } : {}),
      severity,
      ...(source ? { source } : {}),
      createdAt: new Date(now).toISOString(),
      expiresAt,
    },
  };
}

export function isNotificationActive(notification: DashboardNotification, now = Date.now()): boolean {
  if (notification.expiresAt === null) return true;
  const expires = Date.parse(notification.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

/** Drop expired entries, then keep the newest MAX_ACTIVE_NOTIFICATIONS. */
export function activeNotifications(list: DashboardNotification[], now = Date.now()): DashboardNotification[] {
  return list
    .filter((notification) => isNotificationActive(notification, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_ACTIVE_NOTIFICATIONS);
}
