import { readDashboardConfigSync } from "./dashboard-config";

export type IcloudConfig = {
  username: string | null;
  appPassword: string | null;
  caldavUrl: string;
  calendars: string[];
  reminders: string[];
  syncDays: number;
  defaultReminderDurationMs: number;
  authBackoffMs: number;
  syncIntervalMs: number;
  enabled: boolean;
};

let disabledLogged = false;

function envList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function envSyncDays(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.max(1, Math.min(60, Math.round(parsed)));
}

export function readIcloudConfig(): IcloudConfig {
  const dashboardConfig = readDashboardConfigSync();
  const username = process.env.ICLOUD_USERNAME?.trim() || null;
  const appPassword = process.env.ICLOUD_APP_PASSWORD?.trim() || null;
  const syncDays = envSyncDays(process.env.ICLOUD_SYNC_DAYS) ?? dashboardConfig.tasks.iCloud.defaultSyncDays;
  const calendars = envList(process.env.ICLOUD_CALENDARS);
  const reminders = envList(process.env.ICLOUD_REMINDERS);

  return {
    username,
    appPassword,
    caldavUrl: dashboardConfig.tasks.iCloud.caldavUrl,
    calendars: calendars.length ? calendars : dashboardConfig.tasks.iCloud.calendars,
    reminders: reminders.length ? reminders : dashboardConfig.tasks.iCloud.reminders,
    syncDays,
    defaultReminderDurationMs: dashboardConfig.tasks.iCloud.defaultReminderDurationMs,
    authBackoffMs: dashboardConfig.tasks.iCloud.authBackoffMs,
    syncIntervalMs: dashboardConfig.tasks.iCloud.syncIntervalMs,
    enabled: Boolean(username && appPassword),
  };
}

export function isIcloudEnabled(config = readIcloudConfig()) {
  return config.enabled;
}

export function logIcloudDisabledOnce() {
  if (disabledLogged) {
    return;
  }

  disabledLogged = true;
  console.info("[nova-dashboard] iCloud sync disabled; ICLOUD_USERNAME or ICLOUD_APP_PASSWORD is unset");
}
