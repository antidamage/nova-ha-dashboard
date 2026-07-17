import type {
  ManagedComputerOrientation,
  ManagedComputerPlatform,
  ManagedComputerPublic,
} from "../../lib/managed-computers";

export type ManagedComputerFormValue = ManagedComputerPublic;
export type ManagedComputerPlatformValue = ManagedComputerPlatform;
export type ManagedComputerOrientationValue = ManagedComputerOrientation;

const COMPUTERS_ENDPOINT = "/api/desktop/computers";

type DesktopSyncResult = { id: string; name: string; ok: boolean; error?: string };

export async function loadManagedComputers() {
  const response = await fetch(COMPUTERS_ENDPOINT, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load managed computers");
  }
  return (payload.computers ?? []) as ManagedComputerFormValue[];
}

export async function saveManagedComputers(computers: ManagedComputerFormValue[]) {
  const response = await fetch(COMPUTERS_ENDPOINT, {
    body: JSON.stringify({ computers }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to save managed computers");
  }
  return (payload.computers ?? []) as ManagedComputerFormValue[];
}

async function postDesktopSync(force: boolean): Promise<DesktopSyncResult[]> {
  const response = await fetch("/api/desktop/sync", {
    body: JSON.stringify({ force }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to apply managed desktop wallpapers");
  }
  // Automatic (non-force) syncs return `{ queued: true }` with no results — the
  // push runs in the background so the theme change never waits on SSH.
  return (payload.results ?? []) as DesktopSyncResult[];
}

// Manual "Apply" action: force-push even when the recorded wallpaper already
// matches, so a desktop that drifted manually can be repaired.
export async function applyManagedDesktopWallpapers() {
  return postDesktopSync(true);
}

// Automatic, screen-aware trigger (leaving config, or a dark/light flip on the
// dashboard). Runs the deduplicated path so the same image is never sent twice
// in a row. Safe to fire-and-forget; failures are surfaced via the response.
export async function requestManagedDesktopWallpaperSync(): Promise<DesktopSyncResult[]> {
  if (process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true") {
    return [];
  }
  return postDesktopSync(false);
}
