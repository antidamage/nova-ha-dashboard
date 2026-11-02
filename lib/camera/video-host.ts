import { readDashboardConfig } from "../dashboard-config";

/** The configured capture host, or null to read this host's own recording. */
export function configuredVideoHost(raw: unknown): URL | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim().replace(/\/+$/, ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** The capture host's URL for one of a camera's files, or null with no host configured. */
export async function videoHostFileUrl(cameraId: string, file: string): Promise<string | null> {
  const config = await readDashboardConfig();
  const host = configuredVideoHost(config.dashboard.camera.outside.videoHostUrl);
  if (!host) return null;
  return `${host.toString().replace(/\/+$/, "")}/camera/${encodeURIComponent(cameraId)}/${encodeURIComponent(file)}`;
}

/**
 * Server side only: the video host requires this token and it must never reach client
 * JS. See authentik/specs/authentik-sso.md "Camera bypass contract".
 */
export function videoHostAuthHeaders(): Record<string, string> {
  const cameraToken = process.env.NOVA_CAMERA_TOKEN?.trim();
  return cameraToken ? { authorization: `Bearer ${cameraToken}` } : {};
}
