import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseModuleManifest } from "./manifest";

async function importWithTempStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-modules-"));
  vi.stubEnv("NOVA_DASHBOARD_MODULES_DIR", path.join(tempDir, "modules"));
  vi.stubEnv("NOVA_DASHBOARD_SECRETS_PATH", path.join(tempDir, "dashboard-secrets.json"));
  vi.resetModules();
  return { store: await import("./store"), tempDir };
}

const MANIFEST = {
  id: "fixture-module",
  name: "Fixture",
  version: "1.0.0",
  description: "Test fixture",
  hooks: ["entity.action", "thermostat.transition", "card.body.after"],
  secrets: ["fixture.token"],
  messages: { "thermostat.transition": "{entity} {state}" },
  configSchema: {
    type: "object",
    properties: {
      label: { type: "string", default: "hello" },
      "fixture.token": { type: "string", format: "secret" },
      volume: { type: "number", minimum: 0, maximum: 10, default: 5 },
      nested: { type: "object", properties: { enabled: { type: "boolean", default: true } } },
    },
  },
};

function packageZip(overrides: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  return zipSync({
    "module.json": strToU8(JSON.stringify({ ...MANIFEST, ...overrides })),
    "server.mjs": strToU8("export default { register() {} };\n"),
    "client.mjs": strToU8("export default { register() {} };\n"),
    ...Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])),
  });
}

describe("module manifest", () => {
  it("names the offending hook rather than just refusing", () => {
    const parsed = parseModuleManifest({ ...MANIFEST, hooks: ["entity.action", "not.a.hook"] });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("not.a.hook");
  });

  it("rejects a message template for a hook the module never declared", () => {
    const parsed = parseModuleManifest({
      ...MANIFEST,
      messages: { "reminder.due": "nope" },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("reminder.due");
  });

  it("rejects an entry path that escapes the package", () => {
    const parsed = parseModuleManifest({ ...MANIFEST, entry: { server: "../../evil.mjs" } });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.error).toContain("relative path");
  });
});

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

  it("carries existing config across an upgrade", async () => {
    const { store, tempDir } = await importWithTempStore();
    try {
      await store.installModulePackage(packageZip(), "upload:test.zip");
      await store.writeModuleConfig("fixture-module", { label: "mine", volume: 9 });

      await store.installModulePackage(packageZip({ version: "1.1.0" }), "upload:test.zip");
      await expect(store.readModuleConfig("fixture-module")).resolves.toMatchObject({
        label: "mine",
        volume: 9,
      });
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
      expect(summaries[0].secrets).toEqual([{ name: "discord.botToken", configured: false }]);

      // The token must be a secret-typed field, or export would leak it.
      const manifest = await store.readManifest("discord-bot");
      const config = store.coerceModuleConfig(manifest!, { "discord.botToken": "leak-me" });
      expect(store.exportableModuleConfig(manifest!, config)).not.toHaveProperty("discord.botToken");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
