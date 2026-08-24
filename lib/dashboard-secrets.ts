import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

/**
 * Secrets the dashboard is configured with from the config page rather than
 * from the host's environment.
 *
 * They live in their own 0600 file under `data/` and deliberately not in
 * `dashboard-config.json`: config is exportable and importable, and a config
 * export that carries a webhook token is a leak with a friendly button on it.
 * Nothing here is ever returned to a client in full - see `secretPreview`.
 */
export type DashboardSecrets = {
  themeChangeNotificationUrl: string;
};

export type DashboardSecretStatus = {
  themeChangeNotificationUrl: {
    configured: boolean;
    // A shortened, non-reconstructable form for the config page, so the field
    // can show what is set without putting the token on a wall display.
    preview: string | null;
  };
};

const SECRETS_PATH =
  process.env.NOVA_DASHBOARD_SECRETS_PATH ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "dashboard-secrets.json");

const MAX_URL_LENGTH = 2048;

let writeQueue = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accept only an absolute http(s) URL. Anything else - a relative path, a
 * `file:` URL, a shell fragment - is rejected rather than stored and then
 * failing later inside `fetch`.
 */
export function normalizedNotificationUrl(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }
  if (text.length > MAX_URL_LENGTH) {
    throw new Error(`Notification URL must be ${MAX_URL_LENGTH} characters or fewer`);
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Notification URL must be a full http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Notification URL must be a full http:// or https:// URL");
  }
  return parsed.toString();
}

/**
 * Host plus the last path segment, e.g.
 * `api.pushcut.io/.../notifications/Theme%20change`. Enough to recognise what
 * is configured, never enough to replay it.
 */
export function secretPreview(value: string): string | null {
  if (!value) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const tail = segments.slice(-2).join("/");
  return segments.length > 2 ? `${parsed.host}/…/${tail}` : `${parsed.host}/${tail}`;
}

export async function readDashboardSecrets(): Promise<DashboardSecrets> {
  try {
    const value = JSON.parse(await readFile(SECRETS_PATH, "utf8")) as unknown;
    const record = isRecord(value) ? value : {};
    return {
      themeChangeNotificationUrl: typeof record.themeChangeNotificationUrl === "string"
        ? record.themeChangeNotificationUrl
        : "",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { themeChangeNotificationUrl: "" };
    }
    throw error;
  }
}

export async function dashboardSecretStatus(): Promise<DashboardSecretStatus> {
  const secrets = await readDashboardSecrets();
  return {
    themeChangeNotificationUrl: {
      configured: Boolean(secrets.themeChangeNotificationUrl),
      preview: secretPreview(secrets.themeChangeNotificationUrl),
    },
  };
}

/**
 * Write one secret. An empty string clears it, which is how the config page's
 * Clear action works - there is no separate delete path to keep in step.
 */
export async function saveDashboardSecret(
  key: keyof DashboardSecrets,
  value: unknown,
): Promise<DashboardSecretStatus> {
  const normalized = normalizedNotificationUrl(value);
  writeQueue = writeQueue.then(async () => {
    const current = await readDashboardSecrets();
    const next: DashboardSecrets = { ...current, [key]: normalized };
    await mkdir(path.dirname(SECRETS_PATH), { recursive: true });
    const tempPath = `${SECRETS_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await chmod(tempPath, 0o600).catch(() => undefined);
    await rename(tempPath, SECRETS_PATH);
    await chmod(SECRETS_PATH, 0o600).catch(() => undefined);
  });
  await writeQueue;
  return dashboardSecretStatus();
}
