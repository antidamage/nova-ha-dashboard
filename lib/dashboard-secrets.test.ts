import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function importWithTempStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-dashboard-secrets-"));
  vi.stubEnv("NOVA_DASHBOARD_SECRETS_PATH", path.join(tempDir, "dashboard-secrets.json"));
  vi.resetModules();
  return { mod: await import("./dashboard-secrets"), tempDir };
}

describe("dashboard secrets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stores, previews and clears the theme change notification URL", async () => {
    const { mod, tempDir } = await importWithTempStore();
    try {
      await expect(mod.dashboardSecretStatus()).resolves.toEqual({
        themeChangeNotificationUrl: { configured: false, preview: null },
        modules: {},
      });

      const saved = await mod.saveDashboardSecret(
        "themeChangeNotificationUrl",
        "https://api.example.test/TOKEN123/notifications/Theme%20change",
      );
      expect(saved.themeChangeNotificationUrl.configured).toBe(true);
      // The preview must not carry the token.
      expect(saved.themeChangeNotificationUrl.preview).toBe("api.example.test/…/notifications/Theme%20change");
      expect(saved.themeChangeNotificationUrl.preview).not.toContain("TOKEN123");

      // The full value is still on disk for the notifier to use.
      const onDisk = await readFile(path.join(tempDir, "dashboard-secrets.json"), "utf8");
      expect(onDisk).toContain("TOKEN123");

      const cleared = await mod.saveDashboardSecret("themeChangeNotificationUrl", "");
      expect(cleared.themeChangeNotificationUrl).toEqual({ configured: false, preview: null });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects anything that is not an absolute http(s) URL", async () => {
    const { mod, tempDir } = await importWithTempStore();
    try {
      expect(() => mod.normalizedNotificationUrl("/notifications/theme")).toThrow(/http/i);
      expect(() => mod.normalizedNotificationUrl("file:///etc/passwd")).toThrow(/http/i);
      expect(() => mod.normalizedNotificationUrl(`https://example.test/${"a".repeat(2100)}`)).toThrow(/2048/);
      expect(mod.normalizedNotificationUrl("  https://example.test/hook  ")).toBe("https://example.test/hook");
      expect(mod.normalizedNotificationUrl("")).toBe("");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("stores module secrets without previewing enough to replay them", async () => {
    const { mod, tempDir } = await importWithTempStore();
    try {
      const saved = await mod.saveModuleSecret("discord.botToken", "MTIzNDU2Nzg5.SECRETTAIL");
      expect(saved.modules["discord.botToken"].configured).toBe(true);
      expect(saved.modules["discord.botToken"].preview).not.toContain("SECRETTAIL");
      // The raw value is still readable server-side, which is the whole point.
      await expect(mod.readModuleSecret("discord.botToken")).resolves.toBe("MTIzNDU2Nzg5.SECRETTAIL");

      // The unrelated secret is untouched — one file, independent keys.
      await mod.saveDashboardSecret("themeChangeNotificationUrl", "https://example.test/hook");
      await expect(mod.readModuleSecret("discord.botToken")).resolves.toBe("MTIzNDU2Nzg5.SECRETTAIL");

      const cleared = await mod.saveModuleSecret("discord.botToken", "");
      expect(cleared.modules["discord.botToken"]).toBeUndefined();
      expect(cleared.themeChangeNotificationUrl.configured).toBe(true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("rejects module secret names that are not simple identifiers", async () => {
    const { mod, tempDir } = await importWithTempStore();
    try {
      await expect(mod.saveModuleSecret("../escape", "x")).rejects.toThrow(/Secret name/);
      await expect(mod.saveModuleSecret("Discord", "x")).rejects.toThrow(/Secret name/);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
