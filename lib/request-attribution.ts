/**
 * Who sent this request?
 *
 * The bedroom heater was found running at a target its owner had not set, on
 * what turned out to be one of several mornings, and the question "what sent
 * this" could not be answered at all: the two routes that write the heater's
 * mode and target logged nothing, emitted no dashboard event, and recorded no
 * caller. The only trace of any client that night was incidental — Caddy has no
 * access log, so the sole evidence was error-level lines it happened to leak
 * about aborted SSE reads.
 *
 * Caddy proxies the dashboard, so the socket's peer address is the proxy. The
 * forwarded headers are what identify the real caller. Nova is a single
 * household on a LAN plus Tailscale with no untrusted ingress, so trusting them
 * is appropriate here — on a public-facing service it would not be.
 *
 * See specs/bedroom-heater-control-integrity.md §4.
 */

export type CallerAttribution = {
  /** Best available client address: forwarded chain first, then peer. */
  ip: string | null;
  userAgent: string | null;
};

function firstForwardedAddress(value: string | null): string | null {
  if (!value) return null;
  // X-Forwarded-For is a comma-separated chain; the client is leftmost.
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function callerAttribution(request: Request): CallerAttribution {
  const headers = request.headers;
  const ip =
    firstForwardedAddress(headers.get("x-forwarded-for")) ??
    headers.get("x-real-ip") ??
    firstForwardedAddress(headers.get("forwarded")) ??
    null;
  return { ip, userAgent: headers.get("user-agent") };
}
