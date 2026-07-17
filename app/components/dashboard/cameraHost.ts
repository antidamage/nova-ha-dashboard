/**
 * Resolves where the Outside camera stream is embedded FROM.
 *
 * Capture + hardware-encode live on the configured remote video host
 * (currently Nocturnium); nova is a pure consumer. The configured host (a
 * `dashboard.camera.outside.videoHostUrl` text field) is seeded onto the client
 * by the layout head bootstrap as `window.__NOVA_VIDEO_HOST__`. When it is set,
 * the client embeds the stream DIRECTLY from that host (Nocturnium serves it at
 * `/camera/<id>/…`); when it is empty we fall back to nova's own same-origin
 * `/api/camera/<id>/…` routes — the transition state before the capture hardware
 * is physically moved to the configured host.
 *
 * This is the only machine-specific value on nova, and it lives in config, never
 * as a hard-coded constant (the golden rule).
 */

export function normalizeVideoHost(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim().replace(/\/+$/, "") : "";
}

/** The configured video host base, read from the injected global. "" if unset. */
export function cameraHostBase(): string {
  if (typeof window !== "undefined") {
    return normalizeVideoHost((window as { __NOVA_VIDEO_HOST__?: unknown }).__NOVA_VIDEO_HOST__);
  }
  return "";
}

/**
 * Build a camera URL. With a video host configured the path is the remote
 * service's `<host>/camera/<id>/<path>`; otherwise it is nova's same-origin
 * `/api/camera/<id>/<path>`. Pass `hostOverride` to target a specific host (e.g.
 * the config panel's editable field before it has been persisted + reloaded).
 */
export function cameraUrl(cameraId: string, path: string, hostOverride?: string): string {
  const base = hostOverride !== undefined ? normalizeVideoHost(hostOverride) : cameraHostBase();
  return base ? `${base}/camera/${cameraId}/${path}` : `/api/camera/${cameraId}/${path}`;
}
