/**
 * Managed desktop wallpaper sync — facade. The body lives in
 * lib/managed-desktop-sync/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3).
 *
 *   managed-desktop-sync/types.ts        result, plan, record and queue shapes
 *   managed-desktop-sync/theme-model.ts  wallpaper settings, variant signatures
 *   managed-desktop-sync/plan.ts         dark/light resolution, per-target plan
 *   managed-desktop-sync/store.ts        SOLE disk owner: applied-wallpaper record
 *   managed-desktop-sync/sync.ts         SSH push, theme actions, webhook
 *   managed-desktop-sync/queue.ts        SOLE module-state owner: sync queue
 */
export type {
  ManagedDesktopSyncOptions,
  ManagedDesktopSyncResult,
  ManagedDesktopWallpaperPlan,
  WallpaperClientOrientation,
} from "./managed-desktop-sync/types";
export { managedDesktopThemeChangeMayAffectWallpaper } from "./managed-desktop-sync/theme-model";
export {
  createManagedDesktopWallpaperPlan,
  currentDesktopWallpaperAssetId,
  managedDesktopWallpaperNeedsSync,
  managedDesktopWallpaperSignature,
  resolveThemeVariant,
} from "./managed-desktop-sync/plan";
export { syncManagedDesktopWallpapers } from "./managed-desktop-sync/sync";
export { queueManagedDesktopWallpaperSync } from "./managed-desktop-sync/queue";
