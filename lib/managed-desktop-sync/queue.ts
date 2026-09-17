// Sole owner of the in-process sync queue: one sync runs at a time, and
// requests arriving meanwhile collapse into a single pending run.
import { syncManagedDesktopWallpapers } from "./sync";
import type { ManagedDesktopSyncOptions, ManagedDesktopSyncResult, QueuedSyncRequest } from "./types";

let pendingSync: QueuedSyncRequest | null = null;
let syncRunning = false;

function settleSyncRequest(request: QueuedSyncRequest, result: ManagedDesktopSyncResult[] | unknown, ok: boolean) {
  for (const waiter of request.waiters) {
    if (ok) {
      waiter.resolve(result as ManagedDesktopSyncResult[]);
    } else {
      waiter.reject(result);
    }
  }
}

async function runQueuedSync(request: QueuedSyncRequest) {
  try {
    const results = await syncManagedDesktopWallpapers(request.themeValue, request.options);
    settleSyncRequest(request, results, true);
  } catch (error) {
    settleSyncRequest(request, error, false);
    console.error("[managed-desktop] wallpaper sync failed", error);
  } finally {
    const next = pendingSync;
    pendingSync = null;
    if (next) {
      void runQueuedSync(next);
      return;
    }
    syncRunning = false;
  }
}

export function queueManagedDesktopWallpaperSync(themeValue: unknown, options: ManagedDesktopSyncOptions = {}) {
  return new Promise<ManagedDesktopSyncResult[]>((resolve, reject) => {
    const waiter = { reject, resolve };
    if (syncRunning) {
      if (pendingSync) {
        pendingSync.themeValue = themeValue;
        pendingSync.options = options;
        pendingSync.waiters.push(waiter);
        return;
      }
      pendingSync = { options, themeValue, waiters: [waiter] };
      return;
    }

    syncRunning = true;
    void runQueuedSync({ options, themeValue, waiters: [waiter] });
  });
}
