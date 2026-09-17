import type { ManagedComputerOrientation, ManagedComputerPublic } from "../managed-computers/types";

export type ThemeVariant = "dark" | "light";

export type ManagedDesktopSyncResult = {
  action: "skipped" | "wallpaper";
  assetId?: string;
  error?: string;
  id: string;
  // Whether this push also replaced the Windows lock/sign-in screen image.
  lockScreen?: boolean;
  name: string;
  ok: boolean;
  reason?: string;
  variant?: ThemeVariant;
};

export type AppliedWallpaperRecord = {
  appliedAt: string;
  assetId: string;
  assetSignature: string;
  computerSignature: string;
  // The file the lock screen was pointed at, or null when the target does not
  // take a lock screen image. Records written before lock-screen support read
  // back as null, so the first sync after the upgrade re-pushes once.
  lockScreenFileName: string | null;
  remoteFileName: string;
  // Covers every per-application theme action that applies to this machine and
  // the colour they were given, so a changed action - or a changed extracted
  // colour on an unchanged asset - re-fires them. Null for records written
  // before theme actions existed, same as lockScreenFileName.
  themeActionSignature: string | null;
  variant: ThemeVariant;
};

// What the theme-change webhook was last told about. Kept alongside the
// per-computer records because it is the same question - what has already been
// pushed for this wallpaper - asked for a client that is not a managed
// computer.
export type NotifiedWallpaperRecord = {
  assetId: string;
  notifiedAt: string;
  variant: ThemeVariant;
};

export type AppliedWallpaperState = {
  notified?: NotifiedWallpaperRecord;
  targets: Record<string, AppliedWallpaperRecord>;
  version: 1;
};

export type ManagedDesktopWallpaperPlanTarget = {
  assetId: string | null;
  computer: ManagedComputerPublic;
  reason?: "disabled" | "no-wallpaper";
};

export type ManagedDesktopWallpaperPlan = {
  targets: ManagedDesktopWallpaperPlanTarget[];
  variant: ThemeVariant;
};

export type QueuedSyncWaiter = {
  reject: (error: unknown) => void;
  resolve: (value: ManagedDesktopSyncResult[]) => void;
};

export type QueuedSyncRequest = {
  options: ManagedDesktopSyncOptions;
  themeValue: unknown;
  waiters: QueuedSyncWaiter[];
};

// Managed computers are only ever landscape or portrait; the iPad Shortcuts
// endpoint adds a third orientation that isn't a managed-computer concept.
export type WallpaperClientOrientation = ManagedComputerOrientation | "ipad";

export type ManagedDesktopSyncOptions = {
  force?: boolean;
};
