export type IcloudStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  calendars: string[];
  reminders: string[];
  authBackoffUntil?: string;
};

export type TaskAudioStatus = {
  exists: boolean;
};
