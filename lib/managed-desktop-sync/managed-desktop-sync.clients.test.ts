import { rm } from "fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_1,
  ASSET_2,
  ASSET_3,
  importSyncModule,
  themeWithWallpaper,
} from "./managed-desktop-sync.fixtures";

describe("managed desktop sync", () => {
  afterEach(() => {
    vi.doUnmock("../managed-computers");
    vi.doUnmock("../wallpaper-assets");
    vi.doUnmock("../theme-change-notification");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolves the wallpaper a Shortcuts client should show, with a portrait fallback", async () => {
    const { mod, tempDir } = await importSyncModule();
    try {
      const theme = themeWithWallpaper(ASSET_1, {}, { lightAssetId: ASSET_2, selection: "light" });
      await expect(mod.currentDesktopWallpaperAssetId(theme, "landscape")).resolves.toEqual({
        assetId: ASSET_2,
        variant: "light",
      });
      // No portrait asset in this theme, so a phone falls back to landscape.
      await expect(mod.currentDesktopWallpaperAssetId(theme, "portrait")).resolves.toEqual({
        assetId: ASSET_2,
        variant: "light",
      });
      await expect(mod.currentDesktopWallpaperAssetId(null, "portrait")).resolves.toBeNull();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("resolves the iPad wallpaper, falling back to landscape when no iPad asset is set", async () => {
    const { mod, tempDir } = await importSyncModule();
    try {
      const withoutIpad = themeWithWallpaper(ASSET_1);
      await expect(mod.currentDesktopWallpaperAssetId(withoutIpad, "ipad")).resolves.toEqual({
        assetId: ASSET_1,
        variant: "dark",
      });

      const withIpad = themeWithWallpaper(ASSET_1, {
        desktopWallpaper: { ipadAssetId: ASSET_3, landscapeAssetId: ASSET_1, portraitAssetId: null },
      });
      await expect(mod.currentDesktopWallpaperAssetId(withIpad, "ipad")).resolves.toEqual({
        assetId: ASSET_3,
        variant: "dark",
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("notifies the theme-change webhook once per wallpaper, and again on force", async () => {
    const { mod, sendThemeChangeNotification, tempDir } = await importSyncModule();
    try {
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(1);
      expect(sendThemeChangeNotification).toHaveBeenCalledWith({ assetId: ASSET_1, variant: "dark" });

      // Same wallpaper, so the phone has nothing new to fetch.
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(1);

      // The manual Apply button is the repair path: it notifies regardless.
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1), { force: true });
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(2);

      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_3));
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(3);
      expect(sendThemeChangeNotification).toHaveBeenLastCalledWith({ assetId: ASSET_3, variant: "dark" });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("notifies when a dark/light flip changes the wallpaper, and when no computer took it", async () => {
    const { mod, sendThemeChangeNotification, tempDir } = await importSyncModule({ computers: [] });
    try {
      // No managed computers at all - a phone still needs telling.
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(sendThemeChangeNotification).toHaveBeenCalledWith({ assetId: ASSET_1, variant: "dark" });

      await mod.syncManagedDesktopWallpapers(
        themeWithWallpaper(ASSET_1, {}, { lightAssetId: ASSET_2, selection: "light" }),
      );
      expect(sendThemeChangeNotification).toHaveBeenLastCalledWith({ assetId: ASSET_2, variant: "light" });
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("keeps retrying the webhook after a failure, and never fails the sync for it", async () => {
    const { mod, sendThemeChangeNotification, tempDir } = await importSyncModule();
    try {
      sendThemeChangeNotification.mockResolvedValueOnce({ error: "boom", ok: false, sent: false });
      const results = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(results[0]).toMatchObject({ action: "wallpaper", ok: true });

      // Nothing was recorded as notified, so the next sync tries again even
      // though the wallpaper has not changed.
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(sendThemeChangeNotification).toHaveBeenCalledTimes(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
