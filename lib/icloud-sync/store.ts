// Sole owner of the sync's process-wide state: the status the config page
// reads and the in-flight flag.
import { isIcloudEnabled, readIcloudConfig } from "../icloud-config";
import type { IcloudSyncStatus, IcloudSyncStore } from "./types";

const globalWithIcloudSync = globalThis as typeof globalThis & {
  __novaIcloudSync?: IcloudSyncStore;
};

export const store =
  globalWithIcloudSync.__novaIcloudSync ??
  (globalWithIcloudSync.__novaIcloudSync = {
    status: {
      enabled: isIcloudEnabled(),
      calendars: [],
      reminders: [],
    },
    syncing: false,
  });

export function setStatus(next: Partial<IcloudSyncStatus>) {
  store.status = {
    ...store.status,
    ...next,
  };
}

export function getIcloudSyncStatus(): IcloudSyncStatus {
  const config = readIcloudConfig();
  if (!config.enabled) {
    setStatus({
      enabled: false,
      authBackoffUntil: undefined,
      lastError: undefined,
    });
  } else {
    setStatus({ enabled: true });
  }

  return { ...store.status };
}
