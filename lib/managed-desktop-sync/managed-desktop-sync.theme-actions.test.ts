import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_1,
  importSyncModule,
  testComputer,
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

  it("replaces the lock screen on Windows targets that opt in, and only there", async () => {
    const windows = { ...testComputer(), capabilities: { lockScreen: true, sleep: true, wallpaper: true } };
    const linux = {
      ...testComputer(),
      capabilities: { lockScreen: true, sleep: true, wallpaper: true },
      id: "kde-box",
      name: "KDE Box",
      platform: "kde-linux" as const,
    } satisfies ReturnType<typeof testComputer>;
    const { mod, runManagedComputerSsh, tempDir } = await importSyncModule({ computers: [windows, linux] });

    try {
      const results = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));

      expect(results).toEqual([
        expect.objectContaining({ action: "wallpaper", id: "studio-desktop", lockScreen: true, ok: true }),
        expect.objectContaining({ action: "wallpaper", id: "kde-box", lockScreen: false, ok: true }),
      ]);
      // Both machines get the wallpaper; only the Windows one also gets the
      // lock screen. Targets sync in parallel, so order is not asserted.
      expect(runManagedComputerSsh.mock.calls.map(([, command]) => command).sort()).toEqual([
        `apply nova-${ASSET_1}.png`,
        `apply nova-${ASSET_1}.png`,
        `lockscreen nova-${ASSET_1}.png`,
        "theme-actions",
      ]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("re-syncs when the lock screen capability is turned off, despite an unchanged asset", async () => {
    const withLockScreen = { ...testComputer(), capabilities: { lockScreen: true, sleep: true, wallpaper: true } };
    const computers = [withLockScreen];
    const { mod, runManagedComputerSsh, tempDir } = await importSyncModule({ computers });

    try {
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      // wallpaper + lock screen + theme actions
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(3);

      computers[0] = { ...withLockScreen, capabilities: { lockScreen: false, sleep: true, wallpaper: true } };
      const afterToggle = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(afterToggle[0]).toMatchObject({ action: "wallpaper", lockScreen: false, ok: true });
      // wallpaper + theme actions, no lock screen
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(5);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("builds the theme action context from the asset being pushed", async () => {
    const { mod, runDesktopThemeActions, tempDir } = await importSyncModule({ highlightHex: "#AABBCC" });

    try {
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(runDesktopThemeActions).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: ASSET_1,
          highlight: expect.objectContaining({ hex: "#AABBCC" }),
          remoteFileName: `nova-${ASSET_1}.png`,
          variant: "dark",
        }),
      );
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("skips an unchanged target, so theme actions do not re-run for nothing", async () => {
    const { mod, runDesktopThemeActions, tempDir } = await importSyncModule();

    try {
      await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(runDesktopThemeActions).toHaveBeenCalledTimes(1);

      const second = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(second[0]).toMatchObject({ action: "skipped", reason: "unchanged-wallpaper" });
      expect(runDesktopThemeActions).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("re-fires theme actions when only the extracted colour changed", async () => {
    const stateFile = path.join(await mkdtemp(path.join(os.tmpdir(), "nova-signature-")), "state.json");
    vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", stateFile);

    const first = await importSyncModule({ highlightHex: "#111111" });
    try {
      // Both runs must share one state file, so the second sees the first's record.
      vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", stateFile);
      await first.mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));

      vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", stateFile);
      const second = await importSyncModule({ highlightHex: "#222222" });
      vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", stateFile);
      const results = await second.mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));

      // The asset never changed; only the colour the actions would paint did.
      expect(results[0]).toMatchObject({ action: "wallpaper", ok: true });
      expect(second.runDesktopThemeActions).toHaveBeenCalledTimes(1);
      await rm(second.tempDir, { force: true, recursive: true });
    } finally {
      await rm(first.tempDir, { force: true, recursive: true });
    }
  });
});
