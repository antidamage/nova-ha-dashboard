import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  compilePhonoscopeYaml,
  PHONOSCOPE_LIMITS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_MODULE_VERSION,
  stablePhonoscopeJson,
  type PhonoscopeCompiledModule,
  type PhonoscopeModuleSummary,
  type PhonoscopeSetting,
} from "./phonoscope";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import type { PhonoscopePreferences, PhonoscopeThemeGroup } from "./types";

const MODULE_ROOT =
  process.env.NOVA_PHONOSCOPE_MODULES_DIR ?? path.join(process.cwd(), "data", "phonoscope", "modules");

export const DEFAULT_PHONOSCOPE_CONFIG: Required<Omit<PhonoscopePreferences, "updatedAt">> = {
  activeModuleId: "bpm-pulse",
  activeModuleVersion: "1.0.0",
  idleBehavior: "ambient",
  quality: "auto",
  message: "",
  statusOverlay: true,
  transitionMs: 600,
  housePartyRandomHueOffset: 0,
  providers: {
    spotify: true,
    songle: true,
    essentia: true,
    reccoBeats: true,
    lrclib: true,
  },
  moduleSettings: {},
  pendingStructuralModuleSettings: {},
  moduleReloadGenerations: {},
  themeGroups: [],
  moduleThemeGroupIds: {},
};

export function normalizePhonoscopeThemeGroups(value: unknown): PhonoscopeThemeGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" && /^[a-z][a-z0-9_-]{1,63}$/i.test(entry.id)
      ? entry.id : `group_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const themes = Array.isArray(entry.themes) ? entry.themes.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const theme = item as Record<string, unknown>;
      if (typeof theme.themeId !== "string" || !theme.themeId.trim()) return [];
      return [{
        themeId: theme.themeId.trim(),
        baseVariant: theme.baseVariant === "light" ? "light" as const : "dark" as const,
        swapOnDownbeat: theme.swapOnDownbeat === true,
        genres: Array.isArray(theme.genres)
          ? [...new Set(theme.genres.flatMap((genre) => typeof genre === "string" && genre.trim() ? [genre.trim().slice(0, 48)] : []))]
          : [],
      }];
    }) : [];
    return [{
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 60) : `Theme group ${index + 1}`,
      themes,
      useGenres: typeof entry.useGenres === "boolean"
        ? entry.useGenres
        : themes.some((theme) => theme.genres.length > 0),
      order: entry.order === "shuffle" ? "shuffle" as const : "sequential" as const,
      changeMode: entry.changeMode === "song"
        ? "song" as const
        : entry.changeMode === "downbeat"
          ? "downbeat" as const
          : "interval" as const,
      waitSeconds: Math.max(0, Math.min(600, Number(entry.waitSeconds) || 0)),
      transitionSeconds: Math.max(0, Math.min(600, Number(entry.transitionSeconds) || 0)),
      housePartyHueMode: entry.housePartyHueMode === "complement" ? "complement" as const : "follow" as const,
      housePartyBrightnessMode: ["oppose", "ignore"].includes(String(entry.housePartyBrightnessMode))
        ? entry.housePartyBrightnessMode as "oppose" | "ignore"
        : "follow" as const,
    }];
  });
}

type StoredManifest = PhonoscopeModuleSummary & {
  assets: string[];
  installedAt: string;
  warnings: string[];
};

function packageNameFor(module: Pick<PhonoscopeModuleSummary, "id"> & { packageName?: string }) {
  return module.packageName ?? `nz.skull.nova.visualiser.${module.id}`;
}

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

function hashBytes(values: Uint8Array[]) {
  const hash = createHash("sha256");
  values.forEach((value) => hash.update(value));
  return hash.digest("hex");
}

function builtinRecord() {
  const result = compilePhonoscopeYaml(BUILTIN_PHONOSCOPE_MODULE_YAML);
  if (!result.ok) throw new Error(`Built-in Phonoscope module is invalid: ${result.errors.join("; ")}`);
  const compiled = stablePhonoscopeJson(result.module);
  const hash = hashBytes([Buffer.from(compiled)]);
  const summary: PhonoscopeModuleSummary = {
    id: result.module.id,
    packageName: result.module.packageName,
    version: result.module.version,
    name: result.module.name,
    description: result.module.description,
    dimension: result.module.dimension,
    hash,
    builtin: true,
    settings: result.module.settings,
  };
  return { compiled: result.module, summary, source: BUILTIN_PHONOSCOPE_MODULE_YAML };
}

export async function readPhonoscopeConfig() {
  const preferences = await readDashboardPreferences();
  const raw = preferences.phonoscope ?? {};
  return {
    ...DEFAULT_PHONOSCOPE_CONFIG,
    ...raw,
    providers: { ...DEFAULT_PHONOSCOPE_CONFIG.providers, ...(raw.providers ?? {}) },
    moduleSettings: { ...DEFAULT_PHONOSCOPE_CONFIG.moduleSettings, ...(raw.moduleSettings ?? {}) },
    pendingStructuralModuleSettings: {
      ...DEFAULT_PHONOSCOPE_CONFIG.pendingStructuralModuleSettings,
      ...(raw.pendingStructuralModuleSettings ?? {}),
    },
    moduleReloadGenerations: { ...DEFAULT_PHONOSCOPE_CONFIG.moduleReloadGenerations, ...(raw.moduleReloadGenerations ?? {}) },
    themeGroups: normalizePhonoscopeThemeGroups(raw.themeGroups),
    moduleThemeGroupIds: { ...DEFAULT_PHONOSCOPE_CONFIG.moduleThemeGroupIds, ...(raw.moduleThemeGroupIds ?? {}) },
  };
}

export async function writePhonoscopeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object");
  const input = value as Record<string, unknown>;
  const current = await readPhonoscopeConfig();
  const installed = await listPhonoscopeModules();
  const moduleId = typeof input.activeModuleId === "string" ? input.activeModuleId : current.activeModuleId;
  const moduleVersion = typeof input.activeModuleVersion === "string" ? input.activeModuleVersion : current.activeModuleVersion;
  if (!installed.some((entry) => entry.id === moduleId && entry.version === moduleVersion)) {
    throw new Error(`Phonoscope module ${moduleId}@${moduleVersion} is not installed`);
  }
  const idleBehavior = ["ambient", "black", "return"].includes(String(input.idleBehavior))
    ? input.idleBehavior as PhonoscopePreferences["idleBehavior"]
    : current.idleBehavior;
  const quality = ["auto", "high", "balanced", "performance"].includes(String(input.quality))
    ? input.quality as PhonoscopePreferences["quality"]
    : current.quality;
  const providers = input.providers && typeof input.providers === "object" && !Array.isArray(input.providers)
    ? input.providers as Record<string, unknown>
    : {};
  const themeGroups = normalizePhonoscopeThemeGroups(input.themeGroups ?? current.themeGroups);
  const validGroupIds = new Set(themeGroups.map((group) => group.id));
  const requestedAssignments = input.moduleThemeGroupIds && typeof input.moduleThemeGroupIds === "object"
    && !Array.isArray(input.moduleThemeGroupIds)
    ? input.moduleThemeGroupIds as Record<string, unknown>
    : current.moduleThemeGroupIds;
  const moduleThemeGroupIds = Object.fromEntries(Object.entries(requestedAssignments).flatMap(([id, groupId]) =>
    typeof groupId === "string" && validGroupIds.has(groupId) ? [[id, groupId]] : [],
  ));
  const requestedSettings = input.moduleSettings && typeof input.moduleSettings === "object" && !Array.isArray(input.moduleSettings)
    ? input.moduleSettings as Record<string, unknown>
    : current.moduleSettings;
  const moduleSettings: Record<string, Record<string, number>> = {};
  const normalizeSettingsMap = (requested: Record<string, unknown>, mode: "smooth" | "structural") => {
    const result: Record<string, Record<string, number>> = {};
    for (const [settingModuleId, rawValues] of Object.entries(requested)) {
      if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) continue;
      const declarations = installed.filter((entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion)).at(-1)?.settings;
      if (!declarations) continue;
      const values = rawValues as Record<string, unknown>;
      const normalized: Record<string, number> = {};
      for (const setting of declarations.filter((setting) => setting.updateMode === mode)) {
        if (!(setting.id in values)) continue;
        const resolved = normalizeSettingValue(setting, values[setting.id]);
        if (resolved !== undefined) normalized[setting.id] = resolved;
      }
      if (Object.keys(normalized).length) result[settingModuleId] = normalized;
    }
    return result;
  };
  for (const [settingModuleId, rawValues] of Object.entries(requestedSettings)) {
    if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) continue;
    // Settings are keyed by module id for backward compatibility.  For an
    // inactive module retain the settings declared by its newest installed
    // version; the active module remains pinned to the selected version.
    const declarations = installed.filter(
      (entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion),
    ).at(-1)?.settings;
    if (!declarations) continue;
    const values = rawValues as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const setting of declarations) {
      if (!(setting.id in values)) continue;
      const resolved = normalizeSettingValue(setting, values[setting.id]);
      if (resolved !== undefined) normalized[setting.id] = resolved;
    }
    if (Object.keys(normalized).length) moduleSettings[settingModuleId] = normalized;
  }
  const pendingInput = input.pendingStructuralModuleSettings
    && typeof input.pendingStructuralModuleSettings === "object"
    && !Array.isArray(input.pendingStructuralModuleSettings)
    ? input.pendingStructuralModuleSettings as Record<string, unknown>
    : current.pendingStructuralModuleSettings;
  const pendingStructuralModuleSettings = normalizeSettingsMap(pendingInput, "structural");
  const reloadInput = input.moduleReloadGenerations && typeof input.moduleReloadGenerations === "object"
    && !Array.isArray(input.moduleReloadGenerations)
    ? input.moduleReloadGenerations as Record<string, unknown> : current.moduleReloadGenerations;
  const moduleReloadGenerations = Object.fromEntries(Object.entries(reloadInput).flatMap(([id, value]) =>
    typeof value === "number" && Number.isFinite(value) ? [[id, Math.max(0, Math.floor(value))]] : [],
  ));
  await mergeDashboardPreferences({
    phonoscope: {
      activeModuleId: moduleId,
      activeModuleVersion: moduleVersion,
      idleBehavior,
      quality,
      message: typeof input.message === "string"
        ? Array.from(input.message.trim()).slice(0, 160).join("")
        : current.message,
      statusOverlay: typeof input.statusOverlay === "boolean" ? input.statusOverlay : current.statusOverlay,
      transitionMs: typeof input.transitionMs === "number"
        ? Math.max(0, Math.min(3_000, Math.round(input.transitionMs)))
        : current.transitionMs,
      housePartyRandomHueOffset: typeof input.housePartyRandomHueOffset === "number"
        ? Math.max(0, Math.min(180, input.housePartyRandomHueOffset))
        : current.housePartyRandomHueOffset,
      providers: {
        spotify: typeof providers.spotify === "boolean" ? providers.spotify : current.providers.spotify,
        songle: typeof providers.songle === "boolean" ? providers.songle : current.providers.songle,
        essentia: typeof providers.essentia === "boolean" ? providers.essentia : current.providers.essentia,
        reccoBeats: typeof providers.reccoBeats === "boolean" ? providers.reccoBeats : current.providers.reccoBeats,
        lrclib: typeof providers.lrclib === "boolean" ? providers.lrclib : current.providers.lrclib,
      },
      moduleSettings,
      pendingStructuralModuleSettings,
      moduleReloadGenerations,
      themeGroups,
      moduleThemeGroupIds,
    },
  });
  return readPhonoscopeConfig();
}

function normalizeSettingValue(setting: PhonoscopeSetting, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (setting.control === "toggle") return value >= 0.5 ? 1 : 0;
  if (setting.control === "select") {
    return setting.options.some((option) => option.value === value) ? value : setting.default;
  }
  const clamped = Math.max(setting.min, Math.min(setting.max, value));
  const stepped = setting.min + Math.round((clamped - setting.min) / setting.step) * setting.step;
  return Number(Math.max(setting.min, Math.min(setting.max, stepped)).toFixed(12));
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
    if (!PHONOSCOPE_MODULE_ID.test(id)) continue;
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
        modules.push(manifest);
      } catch {
        // An interrupted or manually damaged directory is not publishable.
      }
    }
  }
  return modules;
}

function validateArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return normalized;
}

function isAllowedAsset(name: string) {
  return /^assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g)$/i.test(name) || name === "preview.png";
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
  return { module: JSON.parse(compiled) as PhonoscopeCompiledModule, hash: manifest.hash };
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
