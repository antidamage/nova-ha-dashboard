// The phonoscope-store package's only owner of disk state: the installed
// module tree under MODULE_ROOT — listing, installing, reading and removing
// packages. The configuration itself persists through lib/preferences.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  compilePhonoscopeYaml,
  PHONOSCOPE_CORE_PALETTE_SLOTS,
  PHONOSCOPE_LIMITS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_MODULE_VERSION,
  stablePhonoscopeJson,
  type PhonoscopeCompiledModule,
  type PhonoscopeModuleSummary,
} from "../phonoscope";
import { mergeDashboardPreferences } from "../preferences";
import { RETIRED_PHONOSCOPE_MODULE_IDS } from "./constants";
import {
  builtinRecord,
  hashBytes,
  isAllowedAsset,
  packageNameFor,
  validateArchivePath,
} from "./package-model";
import { readPhonoscopeConfig } from "./read-config";
import type { StoredManifest } from "./types";

const MODULE_ROOT =
  process.env.NOVA_PHONOSCOPE_MODULES_DIR ?? path.join(process.cwd(), "data", "phonoscope", "modules");

function safeSegment(value: string, pattern: RegExp, label: string) {
  if (!pattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function moduleDirectory(id: string, version: string) {
  return path.join(
    MODULE_ROOT,
    safeSegment(id, PHONOSCOPE_MODULE_ID, "module id"),
    safeSegment(version, PHONOSCOPE_MODULE_VERSION, "module version"),
  );
}


async function readStoredManifest(directory: string) {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as StoredManifest;
}

export async function listPhonoscopeModules(): Promise<PhonoscopeModuleSummary[]> {
  const modules: PhonoscopeModuleSummary[] = [builtinRecord().summary];
  let ids: string[];
  try {
    ids = await readdir(MODULE_ROOT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return modules;
    throw error;
  }
  for (const id of ids.sort()) {
    if (!PHONOSCOPE_MODULE_ID.test(id) || RETIRED_PHONOSCOPE_MODULE_IDS.has(id)) continue;
    let versions: string[] = [];
    try {
      versions = await readdir(path.join(MODULE_ROOT, id));
    } catch {
      continue;
    }
    for (const version of versions.sort()) {
      if (!PHONOSCOPE_MODULE_VERSION.test(version)) continue;
      try {
        const manifest = await readStoredManifest(path.join(MODULE_ROOT, id, version));
        modules.push({
          ...manifest,
          paletteSlots: manifest.paletteSlots ?? PHONOSCOPE_CORE_PALETTE_SLOTS,
        });
      } catch {
        // An interrupted or manually damaged directory is not publishable.
      }
    }
  }
  return modules;
}


export async function installPhonoscopePackage(bytes: Uint8Array) {
  if (bytes.byteLength > PHONOSCOPE_LIMITS.compressedBytes) {
    throw new Error(`Package exceeds ${PHONOSCOPE_LIMITS.compressedBytes / 1024 / 1024} MB compressed limit`);
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new Error(`Unreadable ZIP: ${error instanceof Error ? error.message : "invalid archive"}`);
  }
  const normalizedFiles = new Map<string, Uint8Array>();
  let extractedBytes = 0;
  for (const [rawName, value] of Object.entries(files)) {
    if (rawName.replaceAll("\\", "/").endsWith("/")) continue;
    const name = validateArchivePath(rawName);
    extractedBytes += value.byteLength;
    if (extractedBytes > PHONOSCOPE_LIMITS.extractedBytes) throw new Error("Package exceeds extracted size limit");
    if (name !== "module.yaml" && !isAllowedAsset(name)) throw new Error(`Unsupported package file: ${name}`);
    normalizedFiles.set(name, value);
  }
  const yamlBytes = normalizedFiles.get("module.yaml");
  if (!yamlBytes) throw new Error("Package must contain module.yaml at its root");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(yamlBytes);
  const result = compilePhonoscopeYaml(source);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  if (RETIRED_PHONOSCOPE_MODULE_IDS.has(result.module.id)) {
    throw new Error(`Phonoscope module ${result.module.id} is retired`);
  }

  for (const [name, value] of normalizedFiles) {
    if (!isAllowedAsset(name)) continue;
    const metadata = await sharp(value).metadata();
    if (!metadata.width || !metadata.height || metadata.width > PHONOSCOPE_LIMITS.textureDimension || metadata.height > PHONOSCOPE_LIMITS.textureDimension) {
      throw new Error(`${name}: texture must be at most ${PHONOSCOPE_LIMITS.textureDimension}×${PHONOSCOPE_LIMITS.textureDimension}`);
    }
  }

  const target = moduleDirectory(result.module.id, result.module.version);
  const replacedModules = (await listPhonoscopeModules()).filter(
    (module) => !module.builtin && packageNameFor(module) === result.module.packageName,
  );

  const compiledText = stablePhonoscopeJson(result.module);
  const orderedBytes = [...normalizedFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, value]) => [Buffer.from(name), value]);
  const hash = hashBytes([Buffer.from(compiledText), ...orderedBytes]);
  const assets = [...normalizedFiles.keys()].filter(isAllowedAsset).sort();
  const manifest: StoredManifest = {
    id: result.module.id,
    packageName: result.module.packageName,
    version: result.module.version,
    name: result.module.name,
    description: result.module.description,
    dimension: result.module.dimension,
    hash,
    builtin: false,
    settings: result.module.settings,
    paletteSlots: result.module.paletteSlots,
    assets,
    installedAt: new Date().toISOString(),
    warnings: result.warnings,
    ...(normalizedFiles.has("preview.png")
      ? { previewUrl: `/api/phonoscope/modules/${encodeURIComponent(result.module.id)}/${encodeURIComponent(result.module.version)}/assets/preview.png` }
      : {}),
  };
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.install-${randomUUID()}`;
  const replacedTarget = `${target}.replace-${randomUUID()}`;
  let targetWasReplaced = false;
  await mkdir(temporary, { recursive: true });
  try {
    await writeFile(path.join(temporary, "module.yaml"), source, "utf8");
    await writeFile(path.join(temporary, "compiled.json"), compiledText, "utf8");
    await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const [name, value] of normalizedFiles) {
      if (!isAllowedAsset(name)) continue;
      const destination = path.join(temporary, ...name.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, value);
    }
    try {
      await stat(target);
      await rename(target, replacedTarget);
      targetWasReplaced = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, target);

    const config = await readPhonoscopeConfig();
    const replacedActiveModule = replacedModules.some(
      (module) => module.id === config.activeModuleId && module.version === config.activeModuleVersion,
    );
    if (replacedActiveModule && (config.activeModuleId !== result.module.id || config.activeModuleVersion !== result.module.version)) {
      await mergeDashboardPreferences({
        phonoscope: {
          ...config,
          activeModuleId: result.module.id,
          activeModuleVersion: result.module.version,
        },
      });
    }
    await Promise.all(replacedModules
      .filter((module) => module.id !== result.module.id || module.version !== result.module.version)
      .map((module) => rm(moduleDirectory(module.id, module.version), { recursive: true, force: true })));
    if (targetWasReplaced) await rm(replacedTarget, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function readPhonoscopeCompiledModule(id: string, version: string): Promise<{ module: PhonoscopeCompiledModule; hash: string }> {
  if (id === "bpm-pulse" && version === "1.0.0") {
    const builtin = builtinRecord();
    return { module: builtin.compiled, hash: builtin.summary.hash };
  }
  const directory = moduleDirectory(id, version);
  const [compiled, manifest] = await Promise.all([
    readFile(path.join(directory, "compiled.json"), "utf8"),
    readStoredManifest(directory),
  ]);
  const parsed = JSON.parse(compiled) as PhonoscopeCompiledModule;
  return {
    module: {
      ...parsed,
      paletteSlots: parsed.paletteSlots ?? PHONOSCOPE_CORE_PALETTE_SLOTS,
    },
    hash: manifest.hash,
  };
}

export async function readPhonoscopeSource(id: string, version: string) {
  if (id === "bpm-pulse" && version === "1.0.0") return builtinRecord().source;
  return readFile(path.join(moduleDirectory(id, version), "module.yaml"), "utf8");
}

export async function readPhonoscopeAsset(id: string, version: string, assetPath: string) {
  if (id === "bpm-pulse" && version === "1.0.0") throw new Error("Built-in module has no downloadable assets");
  const normalized = validateArchivePath(assetPath);
  if (!isAllowedAsset(normalized)) throw new Error("Unsupported asset path");
  return readFile(path.join(moduleDirectory(id, version), ...normalized.split("/")));
}

export async function removePhonoscopeModule(id: string, version: string) {
  if (id === "bpm-pulse" && version === "1.0.0") throw new Error("The built-in module cannot be removed");
  const config = await readPhonoscopeConfig();
  if (config.activeModuleId === id && config.activeModuleVersion === version) {
    throw new Error("Select another module before deleting the active version");
  }
  const target = moduleDirectory(id, version);
  await rm(target, { recursive: true, force: false });
}
