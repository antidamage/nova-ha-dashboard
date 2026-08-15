import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import { toJSONSchema } from "zod";
import {
  DashboardConfigSchema,
  type ConfigImportResult,
  type ConfigValidationIssue,
  type ConfigValidationResult,
  type DashboardConfig,
  type SecretSetupStatus,
} from "./config-schema";

const CONFIG_DIR = path.join(process.cwd(), "config");
const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "dashboard-config.default.json");
const COMMON_CONFIG_PATH = path.join(CONFIG_DIR, "common.json");
const COMMON_LOCAL_CONFIG_PATH = path.join(CONFIG_DIR, "common.local.json");
const TASKS_CONFIG_PATH = path.join(CONFIG_DIR, "tasks.json");
const RUNTIME_CONFIG_PATH =
  process.env.NOVA_DASHBOARD_CONFIG ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "dashboard-config.json");
/**
 * Optional overlay describing the one household this deployment serves — its
 * devices, rooms, rates. It ships separately from the dashboard (see the
 * nova-household package) so the product stays generic, and an unset variable
 * or a missing file is a supported state, not an error.
 *
 * Deliberately NOT part of `readDefaultDashboardConfig`: that is what demo mode
 * and the config page's defaults view read, and both must stay household-free.
 */
const HOUSEHOLD_CONFIG_PATH = process.env.NOVA_DASHBOARD_HOUSEHOLD_CONFIG?.trim() || null;

let writeQueue = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return override === undefined ? base : override as T;
  }

  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    next[key] = key in next ? mergeDeep(next[key], value) : value;
  }
  return next as T;
}

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

function listFromEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function syncDaysFromEnv(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(60, Math.round(parsed)));
}

export function parseMapCenter(value: string | undefined) {
  const [latText, lngText] = (value ?? "").split(",").map((part) => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }
  return { lat, lng };
}

function envCompatibilityOverrides(): Record<string, unknown> {
  const center = parseMapCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
  const calendars = listFromEnv(process.env.ICLOUD_CALENDARS);
  const reminders = listFromEnv(process.env.ICLOUD_REMINDERS);
  const syncDays = syncDaysFromEnv(process.env.ICLOUD_SYNC_DAYS);
  const novaAssistSatelliteEntityId = process.env.NOVA_ASSIST_SAT_ENTITY?.trim();

  return {
    ...(center ? { mapWeather: { center } } : {}),
    ...(novaAssistSatelliteEntityId
      ? { homeAssistant: { novaAssistSatelliteEntityId } }
      : {}),
    ...(calendars.length || reminders.length || syncDays
      ? {
          tasks: {
            iCloud: {
              ...(calendars.length ? { calendars } : {}),
              ...(reminders.length ? { reminders } : {}),
              ...(syncDays ? { defaultSyncDays: syncDays } : {}),
            },
          },
        }
      : {}),
  };
}

function validationIssues(error: { issues: Array<{ code: string; message: string; path: PropertyKey[] }> }) {
  return error.issues.map<ConfigValidationIssue>((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.length ? issue.path.map(String).join(".") : "$",
  }));
}

export function validateDashboardConfig(value: unknown): ConfigValidationResult {
  const result = DashboardConfigSchema.safeParse(value);
  if (result.success) {
    return { ok: true, config: result.data, errors: [] };
  }
  return { ok: false, errors: validationIssues(result.error) };
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
  const result = validateDashboardConfig(merged);
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
  const result = validateDashboardConfig(merged);
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
  const merged = mergeDeep(mergeDeep(defaults, household), next);
  const result = validateDashboardConfig(merged);
  if (!result.ok) {
    return { ...result, applied: false };
  }

  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(RUNTIME_CONFIG_PATH), { recursive: true });
    const tempPath = `${RUNTIME_CONFIG_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(result.config, null, 2)}\n`, "utf8");
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
  const result = validateDashboardConfig(mergeDeep(mergeDeep(defaults, household), next));
  return { ...result, applied: false } as ConfigImportResult;
}

export function redactDashboardConfig(config: DashboardConfig): DashboardConfig {
  return config;
}

export async function exportDashboardConfig() {
  return redactDashboardConfig(await readDashboardConfig());
}

export function dashboardConfigJsonSchema() {
  const schema = toJSONSchema(DashboardConfigSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;

  return {
    $id: "https://nova-dashboard.example/schemas/dashboard-config.v1.schema.json",
    title: "Nova Dashboard Config",
    ...schema,
  };
}

export async function readSecretSetupStatus(): Promise<SecretSetupStatus> {
  const config = await readDashboardConfig();
  const iCloudUsernameConfigured = Boolean(process.env.ICLOUD_USERNAME?.trim());
  const iCloudAppPasswordConfigured = Boolean(process.env.ICLOUD_APP_PASSWORD?.trim());
  const powershopEmailConfigured = Boolean(process.env.POWERSHOP_EMAIL?.trim());
  const powershopPasswordConfigured = Boolean(process.env.POWERSHOP_PASSWORD?.trim());

  return {
    homeAssistant: {
      urlConfigured: Boolean(process.env.HA_URL?.trim()),
      tokenConfigured: Boolean(process.env.HA_TOKEN?.trim()),
    },
    iCloud: {
      usernameConfigured: iCloudUsernameConfigured,
      appPasswordConfigured: iCloudAppPasswordConfigured,
      enabled: iCloudUsernameConfigured && iCloudAppPasswordConfigured,
    },
    powershop: {
      emailConfigured: powershopEmailConfigured,
      passwordConfigured: powershopPasswordConfigured,
      enabled: powershopEmailConfigured && powershopPasswordConfigured,
    },
    mcp: {
      authRequired: config.mcp.requireBearerAuth,
      bearerTokenConfigured: Boolean(process.env.NOVA_DASHBOARD_MCP_TOKEN?.trim()),
    },
  };
}
