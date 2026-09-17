import type ICAL from "ical.js";

export type IcloudSyncResult = {
  added: number;
  linkedLocal: number;
  updated: number;
  removed: number;
};

export type IcloudSyncStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  calendars: string[];
  reminders: string[];
  authBackoffUntil?: string;
};

export type IcalTime = InstanceType<typeof ICAL.Time>;
export type IcalComponent = InstanceType<typeof ICAL.Component>;

export type IcloudSyncStore = {
  status: IcloudSyncStatus;
  syncing: boolean;
};
