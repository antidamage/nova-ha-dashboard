/**
 * Resolves where the Outside camera stream is embedded FROM.
 *
 * Capture + hardware-encode live on the configured remote video host
 * (currently Nocturnium); nova is a pure consumer. The configured host (a
 * `dashboard.camera.outside.videoHostUrl` text field) is seeded onto the client
 * by the layout head bootstrap as `window.__NOVA_VIDEO_HOST__`. When it is set,
 * the browser uses Nova's same-origin `/api/camera-proxy/...` route, which fetches
 * the stream from that host server-side. This is required for HTTPS dashboard
 * clients: WebKit correctly blocks a direct `http://nocturnium.local:8080`
 * subresource as mixed content. When it is empty we fall back to Nova's local
 * `/api/camera/<id>/...` recorder routes.
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
 * Build a browser-safe, same-origin camera URL. With a video host configured,
 * Nova's server-side proxy resolves the configured host and forwards the path;
 * otherwise the local recorder route is used. `hostOverride` only selects which
 * route family to use — the server deliberately reads the persisted host rather
 * than accepting an arbitrary client-supplied proxy target.
 */
export function cameraUrl(cameraId: string, path: string, hostOverride?: string): string {
  const base = hostOverride !== undefined ? normalizeVideoHost(hostOverride) : cameraHostBase();
  const encodedId = encodeURIComponent(cameraId);
  const cleanPath = path.replace(/^\/+/, "");
  return base
    ? `/api/camera-proxy/${encodedId}/${cleanPath}`
    : `/api/camera/${encodedId}/${cleanPath}`;
}
