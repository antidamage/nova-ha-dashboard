// Sole owner of the dashboard-config files: the four shipped layers, the
// household overlay, the runtime store, and the atomic write.
//
// Merge order, lowest priority first:
//   dashboard-config.default.json → common.json → tasks.json → common.local.json
//     → the household overlay → the runtime store → environment overrides
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import {
  COMMON_CONFIG_PATH,
  COMMON_LOCAL_CONFIG_PATH,
  DEFAULT_CONFIG_PATH,
  HOUSEHOLD_CONFIG_PATH,
  RUNTIME_CONFIG_PATH,
  TASKS_CONFIG_PATH,
} from "./constants";
import { envCompatibilityOverrides } from "./env-model";
import { isRecord, mergeDeep } from "./merge-model";
import { validateDashboardConfig } from "./schema-model";
import { pinUpdateChannel, resolveUpdateChannel, runtimeStoreDocument, withoutUpdateChannel } from "./update-channel-model";
import type { ConfigImportResult, DashboardConfig } from "../config-schema";

let writeQueue = Promise.resolve();

async function readJsonIfExists(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function readJsonIfExistsSync(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readDefaultDashboardConfigValue() {
  const [base, common, tasks, commonLocal] = await Promise.all([
    readJsonIfExists(DEFAULT_CONFIG_PATH),
    readJsonIfExists(COMMON_CONFIG_PATH),
    readJsonIfExists(TASKS_CONFIG_PATH),
    readJsonIfExists(COMMON_LOCAL_CONFIG_PATH),
  ]);
  return mergeDeep(mergeDeep(mergeDeep(base ?? {}, common), tasks), commonLocal);
}

function readDefaultDashboardConfigValueSync() {
  const base = readJsonIfExistsSync(DEFAULT_CONFIG_PATH) ?? {};
  const common = readJsonIfExistsSync(COMMON_CONFIG_PATH);
  const tasks = readJsonIfExistsSync(TASKS_CONFIG_PATH);
  const commonLocal = readJsonIfExistsSync(COMMON_LOCAL_CONFIG_PATH);
  return mergeDeep(mergeDeep(mergeDeep(base, common), tasks), commonLocal);
}

export async function readDefaultDashboardConfig(): Promise<DashboardConfig> {
  const value = await readDefaultDashboardConfigValue();
  const result = validateDashboardConfig(value);
  if (!result.ok) {
    throw new Error(`Default/common/tasks dashboard config is invalid: ${result.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }
  return result.config;
}

export async function readStoredDashboardConfig(): Promise<Partial<DashboardConfig>> {
  const value = await readJsonIfExists(RUNTIME_CONFIG_PATH);
  return isRecord(value) ? value as Partial<DashboardConfig> : {};
}

export async function readHouseholdDashboardConfig(): Promise<Partial<DashboardConfig>> {
  if (!HOUSEHOLD_CONFIG_PATH) {
    return {};
  }
  const value = await readJsonIfExists(HOUSEHOLD_CONFIG_PATH);
  return isRecord(value) ? value as Partial<DashboardConfig> : {};
}

function readHouseholdDashboardConfigSync(): Partial<DashboardConfig> {
  if (!HOUSEHOLD_CONFIG_PATH) {
    return {};
  }
  const value = readJsonIfExistsSync(HOUSEHOLD_CONFIG_PATH);
  return isRecord(value) ? value as Partial<DashboardConfig> : {};
}

export async function readDashboardConfig(): Promise<DashboardConfig> {
  const defaults = await readDefaultDashboardConfig();
  const household = await readHouseholdDashboardConfig();
  const stored = await readStoredDashboardConfig();
  const merged = mergeDeep(mergeDeep(mergeDeep(defaults, household), stored), envCompatibilityOverrides());
  const result = validateDashboardConfig(
    pinUpdateChannel(merged, resolveUpdateChannel(defaults, household)),
  );
  if (!result.ok) {
    throw new Error(`Dashboard config is invalid: ${result.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }
  return result.config;
}

export function readDashboardConfigSync(): DashboardConfig {
  const defaults = readDefaultDashboardConfigValueSync();
  const defaultResult = validateDashboardConfig(defaults);
  if (!defaultResult.ok) {
    throw new Error(`Default/common/tasks dashboard config is invalid: ${defaultResult.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }

  const household = readHouseholdDashboardConfigSync();
  const stored = readJsonIfExistsSync(RUNTIME_CONFIG_PATH);
  const merged = mergeDeep(
    mergeDeep(mergeDeep(defaultResult.config, household), isRecord(stored) ? stored : {}),
    envCompatibilityOverrides(),
  );
  const result = validateDashboardConfig(
    pinUpdateChannel(merged, resolveUpdateChannel(defaultResult.config, household)),
  );
  if (!result.ok) {
    throw new Error(`Dashboard config is invalid: ${result.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }
  return result.config;
}

export async function writeDashboardConfig(next: unknown): Promise<ConfigImportResult> {
  const defaults = await readDefaultDashboardConfig();
  // Compose over the household overlay too. The runtime store holds a complete
  // document, so composing over bare defaults would write generic values on top
  // of this home's and silently undo the household layer on the next save.
  const household = await readHouseholdDashboardConfig();
  // The channel is not importable: a caller cannot set it, and the document
  // written below does not carry it either.
  const merged = mergeDeep(mergeDeep(defaults, household), withoutUpdateChannel(next));
  const result = validateDashboardConfig(merged);
  if (!result.ok) {
    return { ...result, applied: false };
  }

  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(RUNTIME_CONFIG_PATH), { recursive: true });
    const tempPath = `${RUNTIME_CONFIG_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(runtimeStoreDocument(result.config), null, 2)}\n`, "utf8");
    await rename(tempPath, RUNTIME_CONFIG_PATH);
  });

  await writeQueue;
  return { ...result, applied: true };
}

/**
 * Apply a partial config on top of the current active config (deep-merged), so
 * an agent can configure one module at a time instead of round-tripping the
 * whole document.
 */
export async function patchDashboardConfig(partial: unknown): Promise<ConfigImportResult> {
  const current = await readDashboardConfig();
  return writeDashboardConfig(mergeDeep(current, partial));
}

export async function dryRunDashboardConfigImport(next: unknown): Promise<ConfigImportResult> {
  const defaults = await readDefaultDashboardConfig();
  const household = await readHouseholdDashboardConfig();
  const result = validateDashboardConfig(
    mergeDeep(mergeDeep(defaults, household), withoutUpdateChannel(next)),
  );
  return { ...result, applied: false } as ConfigImportResult;
}

export function redactDashboardConfig(config: DashboardConfig): DashboardConfig {
  return config;
}

export async function exportDashboardConfig() {
  return redactDashboardConfig(await readDashboardConfig());
}
