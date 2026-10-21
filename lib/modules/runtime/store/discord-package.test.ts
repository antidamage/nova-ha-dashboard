import { readFile, rm } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importWithTempStore } from "./store.fixtures";

describe("the real Discord module package", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Guards the contract between the two repos: if the manifest or the packaging
  // drifts, this fails here rather than at install time on the live dashboard.
  it("installs, if it has been built", async () => {
    const zipPath = path.join(
      process.cwd(),
      "..",
      "nova-module-discord",
      "nova-module-discord-0.1.0.zip",
    );
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(zipPath));
    } catch {
      // The module repo is built separately; skip rather than fail a checkout
      // that has not built it.
      return;
    }

    const { store, tempDir } = await importWithTempStore();
    try {
      const result = await store.installModulePackage(bytes, "test");
      expect(result.id).toBe("discord-bot");

      const summaries = await store.moduleSummaries();
      expect(summaries[0]).toMatchObject({ id: "discord-bot", hasServer: true, hasClient: true });
      // The package declares separate bot, face-veto and attention credentials.
      expect(summaries[0].secrets).toEqual([
        { name: "discord.botToken", configured: false },
        { name: "discord.faceVetoKey", configured: false },
        { name: "discord.attentionKey", configured: false },
      ]);

      // The token must be a secret-typed field, or export would leak it.
      const manifest = await store.readManifest("discord-bot");
      const config = store.coerceModuleConfig(manifest!, { "discord.botToken": "leak-me" });
      expect(store.exportableModuleConfig(manifest!, config)).not.toHaveProperty("discord.botToken");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
