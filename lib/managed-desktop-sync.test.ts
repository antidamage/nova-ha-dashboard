import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ASSET_1 = "wallpaper_00000000-0000-0000-0000-000000000001";
const ASSET_2 = "wallpaper_00000000-0000-0000-0000-000000000002";
const ASSET_3 = "wallpaper_00000000-0000-0000-0000-000000000003";

function testComputer() {
  return {
    address: "computer.local",
    capabilities: { sleep: true, wallpaper: true },
    commandTimeoutMs: 15_000,
    enabled: true,
    hostKey: "SHA256:test",
    id: "studio-desktop",
    name: "Studio Desktop",
    orientation: "landscape" as const,
    platform: "windows" as "kde-linux" | "macos" | "windows",
    sshKeyConfigured: true,
    sshKeyPath: path.join(os.tmpdir(), "nova-test-key"),
    sshPublicKey: null,
    updatedAt: "2026-06-01T00:00:00.000Z",
    username: "desktop",
  };
}

function themeWithWallpaper(assetId: string, overrides: Record<string, unknown> = {}, options: { lightAssetId?: string; selection?: string } = {}) {
  return {
    selection: options.selection ?? "dark",
    themes: {
      dark: {
        accent: { cursor: { x: 0, y: 0 }, intensity: 10, rgb: [255, 255, 255] },
        desktopWallpaper: { landscapeAssetId: assetId, portraitAssetId: null },
        ...overrides,
      },
      light: {
        desktopWallpaper: { landscapeAssetId: options.lightAssetId ?? ASSET_2, portraitAssetId: null },
      },
    },
  };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

async function importSyncModule(options: {
  computers?: ReturnType<typeof testComputer>[];
  copyImpl?: (computer: unknown, filePath: string, remoteFileName: string) => Promise<unknown>;
  highlightHex?: string;
} = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-managed-desktop-sync-"));
  vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", path.join(tempDir, "wallpaper-state.json"));

  const copyFileToManagedComputer = vi.fn(options.copyImpl ?? (async () => ({ stderr: "", stdout: "" })));
  const runManagedComputerSsh = vi.fn(async () => ({ stderr: "", stdout: "" }));
  vi.resetModules();
  vi.doMock("./managed-computers", () => ({
    copyFileToManagedComputer,
    listManagedComputers: vi.fn(async () => options.computers ?? [testComputer()]),
    remoteLockScreenCommand: vi.fn((_platform: string, fileName: string) => `lockscreen ${fileName}`),
    remoteWallpaperCommand: vi.fn((_platform: string, fileName: string) => `apply ${fileName}`),
    remoteWallpaperFileName: vi.fn((assetId: string) => `nova-${assetId}.png`),
    runManagedComputerSsh,
  }));
  vi.doMock("./wallpaper-assets", () => ({
    readWallpaperAssetFile: vi.fn(async (id: string) => ({
      asset: {
        contentType: "image/png",
        createdAt: "2026-06-01T00:00:00.000Z",
        height: 1080,
        id,
        name: "Wallpaper",
        size: 1000 + Number(id.slice(-1)),
        updatedAt: `2026-06-01T00:00:0${id.slice(-1)}.000Z`,
        width: 1920,
      },
      data: Buffer.alloc(0),
      filePath: path.join(tempDir, id),
    })),
  }));

  // Extraction has its own tests; here it only has to be deterministic.
  vi.doMock("./wallpaper-color", () => ({
    clampForContrast: (color: unknown) => color,
    highlightColorForAsset: vi.fn(async () => ({
      fallback: false,
      hex: options.highlightHex ?? "#2F5F87",
      hsl: { h: 207, l: 0.36, s: 0.48 },
      rgb: { b: 135, g: 95, r: 47 },
    })),
  }));

  // The registry has its own tests. The sync's job is to build the context,
  // fold the signature into change detection, and dispatch - so that is what
  // is asserted here, via a sentinel SSH command.
  const runDesktopThemeActions = vi.fn(async (context: { computer: { platform: string } }) => {
    if (context.computer.platform === "windows") {
      await runManagedComputerSsh(context.computer, "theme-actions");
    }
  });
  vi.doMock("./desktop-theme-actions", () => ({
    desktopThemeActionSignature: vi.fn((context: { computer: { platform: string }; highlight: { hex: string } }) =>
      context.computer.platform === "windows" ? `windows-terminal:${context.highlight.hex}` : ""),
    runDesktopThemeActions,
  }));

  const sendThemeChangeNotification = vi.fn(async () => ({ ok: true, sent: true }));
  vi.doMock("./theme-change-notification", () => ({ sendThemeChangeNotification }));

  return {
    copyFileToManagedComputer,
    mod: await import("./managed-desktop-sync"),
    runDesktopThemeActions,
    runManagedComputerSsh,
    sendThemeChangeNotification,
    tempDir,
  };
}

describe("managed desktop sync", () => {
  afterEach(() => {
    vi.doUnmock("./managed-computers");
    vi.doUnmock("./wallpaper-assets");
    vi.doUnmock("./theme-change-notification");
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
