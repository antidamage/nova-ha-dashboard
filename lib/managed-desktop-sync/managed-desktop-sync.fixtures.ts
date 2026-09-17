// Shared harness for the managed desktop sync suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { vi } from "vitest";

export const ASSET_1 = "wallpaper_00000000-0000-0000-0000-000000000001";
export const ASSET_2 = "wallpaper_00000000-0000-0000-0000-000000000002";
export const ASSET_3 = "wallpaper_00000000-0000-0000-0000-000000000003";

export function testComputer() {
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

export function themeWithWallpaper(assetId: string, overrides: Record<string, unknown> = {}, options: { lightAssetId?: string; selection?: string } = {}) {
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

export async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}

export async function importSyncModule(options: {
  computers?: ReturnType<typeof testComputer>[];
  copyImpl?: (computer: unknown, filePath: string, remoteFileName: string) => Promise<unknown>;
  highlightHex?: string;
} = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-managed-desktop-sync-"));
  vi.stubEnv("NOVA_MANAGED_DESKTOP_WALLPAPER_STATE", path.join(tempDir, "wallpaper-state.json"));

  const copyFileToManagedComputer = vi.fn(options.copyImpl ?? (async () => ({ stderr: "", stdout: "" })));
  const runManagedComputerSsh = vi.fn(async (_computer: unknown, _command: string) => ({ stderr: "", stdout: "" }));
  vi.resetModules();
  vi.doMock("../managed-computers", () => ({
    copyFileToManagedComputer,
    listManagedComputers: vi.fn(async () => options.computers ?? [testComputer()]),
    remoteLockScreenCommand: vi.fn((_platform: string, fileName: string) => `lockscreen ${fileName}`),
    remoteWallpaperCommand: vi.fn((_platform: string, fileName: string) => `apply ${fileName}`),
    remoteWallpaperFileName: vi.fn((assetId: string) => `nova-${assetId}.png`),
    runManagedComputerSsh,
  }));
  vi.doMock("../wallpaper-assets", () => ({
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
  vi.doMock("../wallpaper-color", () => ({
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
  vi.doMock("../desktop-theme-actions", () => ({
    desktopThemeActionSignature: vi.fn((context: { computer: { platform: string }; highlight: { hex: string } }) =>
      context.computer.platform === "windows" ? `windows-terminal:${context.highlight.hex}` : ""),
    runDesktopThemeActions,
  }));

  const sendThemeChangeNotification = vi.fn(async () => ({ ok: true, sent: true }));
  vi.doMock("../theme-change-notification", () => ({ sendThemeChangeNotification }));

  return {
    copyFileToManagedComputer,
    mod: await import("../managed-desktop-sync"),
    runDesktopThemeActions,
    runManagedComputerSsh,
    sendThemeChangeNotification,
    tempDir,
  };
}
