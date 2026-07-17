import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

describe("wallpaper assets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uploads, lists, reads, and removes image assets outside repo defaults", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-wallpapers-"));
    vi.stubEnv("NOVA_DESKTOP_WALLPAPER_DIR", tempDir);
    vi.stubEnv("NOVA_DESKTOP_WALLPAPER_INDEX", path.join(tempDir, "index.json"));
    vi.resetModules();
    const mod = await import("./wallpaper-assets");

    try {
      const asset = await mod.uploadWallpaperAsset({ data: PNG_1X1, name: "one.png" });
      expect(asset.width).toBe(1);
      expect(asset.height).toBe(1);
      expect(await mod.listWallpaperAssets()).toHaveLength(1);
      await expect(mod.readWallpaperAssetFile(asset.id)).resolves.toMatchObject({ asset });
      await mod.removeWallpaperAsset(asset.id);
      expect(await mod.listWallpaperAssets()).toHaveLength(0);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects non-image uploads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-wallpapers-"));
    vi.stubEnv("NOVA_DESKTOP_WALLPAPER_DIR", tempDir);
    vi.stubEnv("NOVA_DESKTOP_WALLPAPER_INDEX", path.join(tempDir, "index.json"));
    vi.resetModules();
    const mod = await import("./wallpaper-assets");

    try {
      await expect(mod.uploadWallpaperAsset({ data: Buffer.from("nope"), name: "nope.txt" })).rejects.toThrow(/PNG, JPEG, or WebP/);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
