import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANIFEST, importWithTempStore, packageZip } from "./store.fixtures";

describe("module store", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("installs a package, lists it, and packs it back without config.json", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      const result = await store.installModulePackage(packageZip(), "upload:test.zip");
      expect(result).toEqual({ id: "fixture-module", version: "1.0.0" });

      const summaries = await store.moduleSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: "fixture-module",
        enabled: true,
        hasClient: true,
        hasServer: true,
      });
      // The secret is declared but not set, which the config tab shows.
      expect(summaries[0].secrets).toEqual([{ name: "fixture.token", configured: false }]);

      await store.writeModuleConfig("fixture-module", { label: "kept" });
      const packed = await store.packModule("fixture-module");
      const { unzipSync } = await import("fflate");
      expect(Object.keys(unzipSync(packed)).sort()).toEqual(["client.mjs", "module.json", "server.mjs"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("carries existing config and durable storage across an upgrade", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload:test.zip");
      await store.writeModuleConfig("fixture-module", { label: "mine", volume: 9 });

      // Whatever the module put in api.storage — an outbound queue, say.
      const storageDir = path.join(store.moduleDir("fixture-module"), "storage");
      await mkdir(storageDir, { recursive: true });
      await writeFile(path.join(storageDir, "queue.json"), '{"lines":[{"text":"kept"}]}', "utf8");

      await store.installModulePackage(packageZip({ version: "1.1.0" }), "upload:test.zip");

      await expect(store.readModuleConfig("fixture-module")).resolves.toMatchObject({
        label: "mine",
        volume: 9,
      });
      // Upgrading is not a reset. Losing this would silently drop real events.
      await expect(readFile(path.join(storageDir, "queue.json"), "utf8")).resolves.toContain("kept");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("leaves installation state out of a downloaded package", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload:test.zip");
      await store.writeModuleConfig("fixture-module", { label: "mine" });
      const storageDir = path.join(store.moduleDir("fixture-module"), "storage");
      await mkdir(storageDir, { recursive: true });
      await writeFile(path.join(storageDir, "queue.json"), "{}", "utf8");

      const { unzipSync } = await import("fflate");
      const names = Object.keys(unzipSync(await store.packModule("fixture-module")));

      expect(names.sort()).toEqual(["client.mjs", "module.json", "server.mjs"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses a package whose entries escape the module directory", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await expect(
        store.installModulePackage(packageZip({}, { "../escape.mjs": "boom" }), "upload"),
      ).rejects.toThrow(/Rejected package entry/);
      // Nothing reaches disk from a rejected package.
      await expect(store.listInstalledIds()).resolves.toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses a client bundle that carries its own React", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      const bad = zipSync({
        "module.json": strToU8(JSON.stringify(MANIFEST)),
        "client.mjs": strToU8("var x = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED';\n"),
      });
      await expect(store.installModulePackage(bad, "upload")).rejects.toThrow(/contain React/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("drops secret values from an exported config but keeps everything else", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload");
      const manifest = await store.readManifest("fixture-module");
      const config = store.coerceModuleConfig(manifest!, {
        label: "shown",
        "fixture.token": "SUPER-SECRET",
        volume: 7,
        nested: { enabled: false },
      });
      const exported = store.exportableModuleConfig(manifest!, config);

      expect(exported).toEqual({ label: "shown", volume: 7, nested: { enabled: false } });
      expect(JSON.stringify(exported)).not.toContain("SUPER-SECRET");
      expect("fixture.token" in exported).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("coerces unknown keys away and clamps numbers to the schema", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload");
      const manifest = await store.readManifest("fixture-module");
      const config = store.coerceModuleConfig(manifest!, {
        label: 12,
        volume: 900,
        somethingElse: "dropped",
      });

      expect(config).toEqual({
        // Wrong type falls back to the schema default rather than being stored.
        label: "hello",
        volume: 10,
        nested: { enabled: true },
      });
      expect("somethingElse" in config).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("deletes a module and forgets its record", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload");
      await store.deleteModule("fixture-module");
      await expect(store.listInstalledIds()).resolves.toEqual([]);
      await expect(store.readInstalledRecords()).resolves.toEqual({});
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("survives a module directory with no manifest", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      const dir = path.join(tempDir, "modules", "broken");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "notes.txt"), "no manifest here", "utf8");

      const summaries = await store.moduleSummaries();
      const broken = summaries.find((entry) => entry.id === "broken");
      expect(broken).toMatchObject({ state: "failed", enabled: false });
      expect(broken?.error).toContain("module.json");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
