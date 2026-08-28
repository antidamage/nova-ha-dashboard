import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { unzipSync, zipSync } from "fflate";
import { dashboardSecretStatus } from "../../dashboard-secrets";
import { manifestEntries, parseModuleManifest, type ModuleManifest } from "./manifest";
import type { InstalledModuleRecord, ModuleSummary } from "./types";

/**
 * On-disk state for installed modules (`specs/module-system.md` §9).
 *
 * These live under `data/` rather than `config/` on purpose: `data/` is excluded
 * from `deploy-nova-dashboard.ps1`'s tar and is never replaced by
 * `nova-release`'s release swap, so an installed module and its config survive
 * both a deploy and a self-update.
 */

export const MODULES_DIR =
  process.env.NOVA_DASHBOARD_MODULES_DIR ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "modules");

const INSTALLED_PATH = () => path.join(MODULES_DIR, "installed.json");

// Mirrors installPhonoscopePackage's limits — same threat, same shape of answer.
export const INSTALL_LIMITS = {
  compressedBytes: 10 * 1024 * 1024,
  extractedBytes: 40 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  fileCount: 200,
};

const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff2", ".json", ".md",
]);

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => undefined);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function moduleDir(id: string) {
  return path.join(MODULES_DIR, id);
}

export async function readInstalledRecords(): Promise<Record<string, InstalledModuleRecord>> {
  const value = await readJson(INSTALLED_PATH());
  if (!isRecord(value)) {
    return {};
  }
  const records: Record<string, InstalledModuleRecord> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    records[id] = {
      id,
      version: typeof entry.version === "string" ? entry.version : "0.0.0",
      enabled: entry.enabled !== false,
      source: typeof entry.source === "string" ? entry.source : "unknown",
      installedAt: typeof entry.installedAt === "string" ? entry.installedAt : new Date(0).toISOString(),
      state: entry.state === "failed" || entry.state === "disabled" ? entry.state : "loaded",
      error: typeof entry.error === "string" ? entry.error : undefined,
    };
  }
  return records;
}

export async function patchInstalledRecord(id: string, patch: Partial<InstalledModuleRecord>) {
  return enqueue(async () => {
    const records = await readInstalledRecords();
    const current = records[id];
    if (!current && !patch.version) {
      return records;
    }
    records[id] = {
      id,
      version: patch.version ?? current?.version ?? "0.0.0",
      enabled: patch.enabled ?? current?.enabled ?? true,
      source: patch.source ?? current?.source ?? "unknown",
      installedAt: patch.installedAt ?? current?.installedAt ?? new Date().toISOString(),
      state: patch.state ?? current?.state ?? "loaded",
      // An explicit null clears a previously recorded failure; undefined keeps it.
      error: "error" in patch ? patch.error : current?.error,
    };
    await writeJsonAtomic(INSTALLED_PATH(), records);
    return records;
  });
}

async function removeInstalledRecord(id: string) {
  return enqueue(async () => {
    const records = await readInstalledRecords();
    delete records[id];
    await writeJsonAtomic(INSTALLED_PATH(), records);
  });
}

export async function readManifest(id: string): Promise<ModuleManifest | null> {
  const value = await readJson(path.join(moduleDir(id), "module.json"));
  if (value === undefined) {
    return null;
  }
  const parsed = parseModuleManifest(value);
  return parsed.ok ? parsed.manifest : null;
}

export async function listInstalledIds(): Promise<string[]> {
  try {
    const entries = await readdir(MODULES_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** mtime+size of the client bundle, so its import URL changes when the file does. */
export async function clientVersionToken(id: string, entry: string): Promise<string> {
  try {
    const info = await stat(path.join(moduleDir(id), entry));
    return `${Math.trunc(info.mtimeMs)}-${info.size}`;
  } catch {
    return "0";
  }
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function moduleSummaries(
  statuses?: Map<string, ModuleSummary["status"]>,
): Promise<ModuleSummary[]> {
  const [ids, records, secretStatus] = await Promise.all([
    listInstalledIds(),
    readInstalledRecords(),
    dashboardSecretStatus(),
  ]);
  const summaries: ModuleSummary[] = [];
  for (const id of ids) {
    const manifest = await readManifest(id);
    if (!manifest) {
      const record = records[id];
      summaries.push({
        id,
        name: id,
        version: record?.version ?? "0.0.0",
        description: "",
        enabled: false,
        state: "failed",
        error: "module.json is missing or invalid",
        hooks: [],
        hasClient: false,
        hasServer: false,
        clientVersion: "0",
        secrets: [],
      });
      continue;
    }
    const entries = manifestEntries(manifest);
    const record = records[id];
    summaries.push({
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      repository: manifest.repository,
      enabled: record?.enabled ?? true,
      state: record?.state ?? "loaded",
      error: record?.error,
      hooks: manifest.hooks,
      hasClient: await fileExists(path.join(moduleDir(id), entries.client)),
      hasServer: await fileExists(path.join(moduleDir(id), entries.server)),
      clientVersion: await clientVersionToken(id, entries.client),
      secrets: manifest.secrets.map((name) => ({
        name,
        configured: Boolean(secretStatus.modules[name]?.configured),
      })),
      status: statuses?.get(id),
    });
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function readModuleConfig(id: string): Promise<Record<string, unknown>> {
  const value = await readJson(path.join(moduleDir(id), "config.json"));
  return isRecord(value) ? value : {};
}

export async function writeModuleConfig(id: string, config: Record<string, unknown>) {
  return enqueue(() => writeJsonAtomic(path.join(moduleDir(id), "config.json"), config));
}

/**
 * Coerce an incoming config against the manifest's schema. Unknown keys are
 * dropped rather than stored, and a value of the wrong type falls back to the
 * schema default — a bad import should not be able to wedge a module.
 */
export function coerceModuleConfig(
  manifest: ModuleManifest,
  input: unknown,
): Record<string, unknown> {
  const source = isRecord(input) ? input : {};
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(manifest.configSchema.properties)) {
    if (field.type === "object") {
      const nested = isRecord(source[key]) ? (source[key] as Record<string, unknown>) : {};
      const group: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(field.properties)) {
        const value = coerceLeaf(child, nested[childKey]);
        if (value !== undefined) {
          group[childKey] = value;
        }
      }
      out[key] = group;
      continue;
    }
    const value = coerceLeaf(field, source[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function coerceLeaf(
  field: { type: "boolean" | "string" | "number"; default?: unknown; enum?: string[]; minimum?: number; maximum?: number },
  value: unknown,
): unknown {
  if (field.type === "boolean") {
    return typeof value === "boolean" ? value : (field.default as boolean | undefined);
  }
  if (field.type === "number") {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : undefined;
    if (numeric === undefined) {
      return field.default as number | undefined;
    }
    const min = field.minimum ?? Number.NEGATIVE_INFINITY;
    const max = field.maximum ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(numeric, min), max);
  }
  const text = typeof value === "string" ? value : undefined;
  if (text === undefined) {
    return field.default as string | undefined;
  }
  if (field.enum && !field.enum.includes(text)) {
    return field.default as string | undefined;
  }
  return text;
}

/**
 * Export drops every `format: "secret"` value entirely rather than blanking it,
 * so an exported file cannot be mistaken for one that carries a token.
 */
export function exportableModuleConfig(manifest: ModuleManifest, config: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(manifest.configSchema.properties)) {
    if (field.type !== "object") {
      if (field.format === "secret") {
        continue;
      }
      if (key in config) {
        out[key] = config[key];
      }
      continue;
    }
    const nested = isRecord(config[key]) ? (config[key] as Record<string, unknown>) : {};
    const group: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(field.properties)) {
      if (child.format === "secret") {
        continue;
      }
      if (childKey in nested) {
        group[childKey] = nested[childKey];
      }
    }
    out[key] = group;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Install / uninstall / pack
// ---------------------------------------------------------------------------

export type InstallResult = { id: string; version: string };

function assertSafeEntryName(name: string) {
  if (name.startsWith("/") || name.includes("..") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`Rejected package entry "${name}"`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => !segment || segment.startsWith("."))) {
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (segments.length === 1) {
    if (name === "module.json" || name.endsWith(".mjs") || name.endsWith(".js")) {
      return;
    }
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (segments[0] !== "assets") {
    throw new Error(`Rejected package entry "${name}"`);
  }
  if (!ALLOWED_ASSET_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    throw new Error(`Rejected asset "${name}"`);
  }
}

/**
 * Unpack, validate, then write. Nothing reaches disk until every entry has
 * passed — a rejected package leaves no trace.
 */
export async function installModulePackage(
  zipBytes: Uint8Array,
  source: string,
): Promise<InstallResult> {
  if (zipBytes.byteLength > INSTALL_LIMITS.compressedBytes) {
    throw new Error("Module package is too large");
  }

  const unpacked = unzipSync(zipBytes);
  const names = Object.keys(unpacked).filter((name) => !name.endsWith("/"));
  if (names.length > INSTALL_LIMITS.fileCount) {
    throw new Error("Module package has too many files");
  }

  let total = 0;
  for (const name of names) {
    assertSafeEntryName(name);
    const bytes = unpacked[name];
    if (bytes.byteLength > INSTALL_LIMITS.fileBytes) {
      throw new Error(`"${name}" is too large`);
    }
    total += bytes.byteLength;
    if (total > INSTALL_LIMITS.extractedBytes) {
      throw new Error("Module package expands too large");
    }
  }

  const manifestBytes = unpacked["module.json"];
  if (!manifestBytes) {
    throw new Error("Module package has no module.json");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  } catch {
    throw new Error("module.json is not valid JSON");
  }
  const parsed = parseModuleManifest(manifestValue);
  if (!parsed.ok) {
    throw new Error(`module.json is invalid — ${parsed.error}`);
  }
  const manifest = parsed.manifest;

  const entries = manifestEntries(manifest);
  if (!unpacked[entries.server] && !unpacked[entries.client]) {
    throw new Error("Module package has neither a server nor a client entry");
  }
  // A client bundle carrying its own React would mount a second copy and break
  // hooks at render time. Cheaper to refuse here with a message that says why.
  const clientBytes = unpacked[entries.client];
  if (clientBytes && looksLikeBundledReact(clientBytes)) {
    throw new Error(
      "Client bundle appears to contain React. Mark react/react-dom/react/jsx-runtime external and use api.react.",
    );
  }

  return enqueue(async () => {
    const target = moduleDir(manifest.id);
    const staging = `${target}.${process.pid}.incoming`;
    await rm(staging, { recursive: true, force: true });
    for (const name of names) {
      const filePath = path.join(staging, name);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, unpacked[name]);
    }

    // Carry existing config across an upgrade; a fresh install starts empty.
    const previousConfig = await readJson(path.join(target, "config.json"));
    if (previousConfig !== undefined) {
      await writeFile(
        path.join(staging, "config.json"),
        `${JSON.stringify(coerceModuleConfig(manifest, previousConfig), null, 2)}\n`,
        "utf8",
      );
    }

    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return { id: manifest.id, version: manifest.version };
  }).then(async (result) => {
    await patchInstalledRecord(manifest.id, {
      version: manifest.version,
      source,
      installedAt: new Date().toISOString(),
      state: "loaded",
      error: undefined,
    });
    return result;
  });
}

function looksLikeBundledReact(bytes: Uint8Array): boolean {
  // The bundled-React tells that survive minification: React's own dev warning
  // prefix and the internals field every copy defines.
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)));
  return (
    text.includes("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED") ||
    text.includes("react-dom.production") ||
    text.includes("Invalid hook call. Hooks can only be called")
  );
}

export async function deleteModule(id: string) {
  await rm(moduleDir(id), { recursive: true, force: true });
  await removeInstalledRecord(id);
}

/** Re-pack an installed module for download. `config.json` is never included. */
export async function packModule(id: string): Promise<Uint8Array> {
  const dir = moduleDir(id);
  const files: Record<string, Uint8Array> = {};

  async function walk(relative: string) {
    const entries = await readdir(path.join(dir, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (child === "config.json") {
        continue;
      }
      files[child] = new Uint8Array(await readFile(path.join(dir, child)));
    }
  }

  await walk("");
  return zipSync(files);
}
