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
    platform: "windows" as const,
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
} = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-managed-desktop-sync-"));
  vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", path.join(tempDir, "wallpaper-state.json"));

  const copyFileToManagedComputer = vi.fn(options.copyImpl ?? (async () => ({ stderr: "", stdout: "" })));
  const runManagedComputerSsh = vi.fn(async () => ({ stderr: "", stdout: "" }));
  vi.resetModules();
  vi.doMock("./managed-computers", () => ({
    copyFileToManagedComputer,
    listManagedComputers: vi.fn(async () => options.computers ?? [testComputer()]),
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
      filePath: path.join(tempDir, id),
    })),
  }));

  return {
    copyFileToManagedComputer,
    mod: await import("./managed-desktop-sync"),
    runManagedComputerSsh,
    tempDir,
  };
}

describe("managed desktop sync", () => {
  afterEach(() => {
    vi.doUnmock("./managed-computers");
    vi.doUnmock("./wallpaper-assets");
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
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(1);

      const second = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1));
      expect(second[0]).toMatchObject({
        action: "skipped",
        assetId: ASSET_1,
        ok: true,
        reason: "unchanged-wallpaper",
      });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(1);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(1);

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
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(1);

      const forced = await mod.syncManagedDesktopWallpapers(themeWithWallpaper(ASSET_1), { force: true });
      expect(forced[0]).toMatchObject({ action: "wallpaper", assetId: ASSET_1, ok: true });
      expect(copyFileToManagedComputer).toHaveBeenCalledTimes(2);
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(2);
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
      expect(runManagedComputerSsh).toHaveBeenCalledTimes(1);
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
