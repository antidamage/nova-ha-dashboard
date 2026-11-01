/**
 * Whether to hand the playlist to the browser rather than hls.js: WebKit only.
 *
 * Asking canPlayType is not enough. WebKit's native engine is the reliable one
 * there, but Chromium now answers "maybe" as well (seen on Chrome 156), and its
 * native engine exposes an empty `seekable` on this live playlist, which leaves
 * the DVR window, the scrubber and the jog with nothing to work against.
 */
export function prefersNativeHls(canPlayHls: string, userAgent: string): boolean {
  return Boolean(canPlayHls) && /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(userAgent);
}
