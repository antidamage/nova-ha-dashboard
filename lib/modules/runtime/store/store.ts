// Sole owner of the installed-module disk state: the write queue, the JSON
// primitives, and the installed-record / manifest reads everything else in
// this package builds on (specs/agent-token-footprint.md §4.2).

import { mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { dashboardSecretStatus } from "../../../dashboard-secrets";
import { manifestEntries, parseModuleManifest, type ModuleManifest } from "../manifest";
import type { InstalledModuleRecord, ModuleSummary } from "../types";
import { MODULES_DIR } from "./constants";

const INSTALLED_PATH = () => path.join(MODULES_DIR, "installed.json");

let writeQueue: Promise<unknown> = Promise.resolve();

export function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => undefined);
  return next;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
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

export async function removeInstalledRecord(id: string) {
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
