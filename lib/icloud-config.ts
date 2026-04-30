export type IcloudConfig = {
  username: string | null;
  appPassword: string | null;
  calendars: string[];
  reminders: string[];
  syncDays: number;
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 7;
  }

  return Math.max(1, Math.min(60, Math.round(parsed)));
}

export function readIcloudConfig(): IcloudConfig {
  const username = process.env.ICLOUD_USERNAME?.trim() || null;
  const appPassword = process.env.ICLOUD_APP_PASSWORD?.trim() || null;

  return {
    username,
    appPassword,
    calendars: envList(process.env.ICLOUD_CALENDARS),
    reminders: envList(process.env.ICLOUD_REMINDERS),
    syncDays: envSyncDays(process.env.ICLOUD_SYNC_DAYS),
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
