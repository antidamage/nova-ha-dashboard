import { rm } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_1,
  ASSET_2,
  ASSET_3,
  importSyncModule,
  testComputer,
  themeWithWallpaper,
  waitFor,
} from "./managed-desktop-sync.fixtures";

describe("managed desktop sync", () => {
  afterEach(() => {
    vi.doUnmock("../managed-computers");
    vi.doUnmock("../wallpaper-assets");
    vi.doUnmock("../theme-change-notification");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("only treats selected wallpaper or theme selection changes as wallpaper-affecting", async () => {
    const { mod, tempDir } = await importSyncModule();
    try {
      expect(mod.managedDesktopThemeChangeMayAffectWallpaper(
        themeWithWallpaper(ASSET_1),
        themeWithWallpaper(ASSET_1, { backgroundEffect: { apexGlow: 200 } }),
      )).toBe(false);
      expect(mod.managedDesktopThemeChangeMayAffectWallpaper(
        themeWithWallpaper(ASSET_1),
        themeWithWallpaper(ASSET_2),
      )).toBe(true);
      expect(mod.managedDesktopThemeChangeMayAffectWallpaper(
        themeWithWallpaper(ASSET_1),
        { ...themeWithWallpaper(ASSET_1), selection: "light" },
      )).toBe(true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("does not need wallpaper sync when light/dark changes to the same asset", async () => {
    const { mod, tempDir } = await importSyncModule();
    try {
      const darkSelected = themeWithWallpaper(ASSET_1, {}, { lightAssetId: ASSET_1, selection: "dark" });
      const lightSelected = themeWithWallpaper(ASSET_1, {}, { lightAssetId: ASSET_1, selection: "light" });

      expect(mod.managedDesktopThemeChangeMayAffectWallpaper(darkSelected, lightSelected)).toBe(true);
      await expect(mod.managedDesktopWallpaperNeedsSync(darkSelected, lightSelected)).resolves.toBe(false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("skips automatic wallpaper sends after the same target asset was applied", async () => {
    const { copyFileToManagedComputer, mod, runManagedComputerSsh, tempDir } = await importSyncModule();
    try {
      const first = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(first[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_1, ok: true });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(1);
      // A Windows push is two commands: apply the wallpaper, then nudge
      // Windows Terminal into reloading its settings.
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(2);

      const second = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(second[0]).toMatchObject({
        action: "skipped",
        assetId: ASSET_1,
        ok: true,
        reason: "unchanged-wallpaper",
      });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(1);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(2);

      const lightSameAsset = await mod.syncManagedDesktopWallpapers(
        themeWithWallpaper(ASSET_1, {}, { lightAssetId: ASSET_1, selection: "light" }),
      );
      expect(lightSameAsset[0]).toMatchObject({
        action: "skipped",
        assetId: ASSET_1,
        ok: true,
        reason: "unchanged-wallpaper",
      });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(1);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(2);

      const forced = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1), { force: true });
      expect(forced[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_1, ok: true });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(2);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(4);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("only applies wallpapers to configured managed computers", async () => {
    const { copyFileToManagedComputer, mod, runManagedComputerSsh, tempDir } = await importSyncModule({
      computers: [testComputer()],
    });

    try {
      const results = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));

      expect(results).toEqual([
        expect.objectContaining({
          action: "wallpaper",
          assetId: ASSET_1,
          id: "studio-desktop",
          ok: true,
        }),
      ]);
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(1);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(2);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });


  it("coalesces queued automatic wallpaper syncs to the newest pending request", async () => {
    let releaseFirstCopy: (() => void) | undefined;
    let copyCallCount = 0;
    const firstCopyGate = new Promise<void>((resolve) => {
      releaseFirstCopy = resolve;
    });
    const { copyFileToManagedComputer, mod, tempDir } = await importSyncModule({
      copyImpl: vi.fn(async () => {
        copyCallCount += 1;
        if (copyCallCount === 1) {
          await firstCopyGate;
        }
        return { stderr: "", stdout: "" };
      }),
    });

    try {
      const first = mod.queueManagedDesktopWallpaperSync(themeWithWallpaper(ASSET_1));
      await waitFor(() => copyFileToManagedComputer.mock.calls.length === 1);

      const stalePending = mod.queueManagedDesktopWallpaperSync(themeWithWallpaper(ASSET_2));
      const latestPending = mod.queueManagedDesktopWallpaperSync(themeWithWallpaper(ASSET_3));
      releaseFirstCopy?.();

      const [firstResult, staleResult, latestResult] = await Promise.all([first, stalePending, latestPending]);
      expect(firstResult[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_1 });
      expect(staleResult[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_3 });
      expect(latestResult[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_3 });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(2);
      expect(copyFileToManagedComputer.mock.calls.map(([, filePath]) => path.basename(String(filePath)))).toEqual([ASSET_1, ASSET_3]);
    } finally {
      releaseFirstCopy?.();
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
