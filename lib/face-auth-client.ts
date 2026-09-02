/**
 * Server-side helper for the face service (`specs/face-auth.md` § Key handling).
 *
 * The shape deliberately mirrors `lib/camera-events-client.ts` — a bare fetch
 * helper plus a JSON-forwarding proxy — with one addition that is the whole
 * point of the file: it injects `X-Nova-Face-Key` from the server environment.
 *
 * **Browsers never hold that key.** A key shipped to a browser is a key on every
 * device that loads the dashboard, in every devtools network pane and every
 * `localStorage` dump. So every browser-facing call goes through the same-origin
 * `/api/face/*` routes, which call in here, and the key stays inside the Next.js
 * process. There is no client-side equivalent of this module and there must not
 * be one — nothing here may be imported from a `"use client"` component.
 *
 * If `NOVA_FACE_KEY` is absent the proxy answers 503 rather than calling
 * upstream without it. An unauthenticated call would be refused by the service
 * anyway (it has no unauthenticated mode), but a 403 from upstream reads as
 * "wrong key" while the real fault is an unprovisioned host, and the distinction
 * is the difference between a five-minute fix and an afternoon.
 */

const FACE_AUTH_URL = (process.env.NOVA_FACE_AUTH_URL ?? "http://127.0.0.1:8099").replace(/\/$/, "");

/** Machine-readable reason the enrolment UI renders as "The face service is not responding." */
const SERVICE_UNAVAILABLE = "service_unavailable";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export class FaceAuthKeyMissingError extends Error {
  constructor() {
    super("NOVA_FACE_KEY is not set on this host; refusing to call the face service unauthenticated");
    this.name = "FaceAuthKeyMissingError";
  }
}

/**
 * Read at call time, not at module load: the unit passes secrets with an env
 * file, and a host provisioned after the dashboard started should not need a
 * rebuild to be picked up. Also makes the missing-key path testable.
 */
function faceAuthKey(): string {
  const key = process.env.NOVA_FACE_KEY;
  if (!key) {
    throw new FaceAuthKeyMissingError();
  }
  return key;
}

/**
 * Headers that must survive the proxy hop, and why each one matters.
 *
 * `x-forwarded-for` — nova-face-auth's network binding reads it to decide
 * whether the caller is on the LAN or the tailnet. Next.js runs on loopback
 * behind Caddy, so if the proxy does not forward it the service sees
 * `127.0.0.1` for every browser request, default-denies all of them, and the
 * entire feature is dead. The dangerous part is the obvious fix: adding
 * `127.0.0.1/32` to `FACE_ALLOWED_CIDRS` makes the symptom go away and
 * silently turns network binding into a no-op for exactly the surface it
 * exists to protect, while still reading as enforced. Forward the address
 * instead. It also lands in the audit row and the Discord veto DM, which are
 * useless if every login came from loopback.
 *
 * `x-authentik-*` — Caddy's `ak_forward_auth` copies these onto the request
 * after a successful forward-auth, and the service requires them on `/arm`,
 * `/enrol` and the subject routes. Dropping them 403s every admin action for a
 * correctly signed-in admin, including the lockout re-arm, which is the
 * load-bearing recovery path for the most important control.
 */
const FORWARDED_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-authentik-username",
  "x-authentik-groups",
  "x-authentik-email",
] as const;

/**
 * Copy the request-scoped headers the service needs onto an outbound init.
 *
 * Call this with the inbound `Request` in every route handler. A route that
 * forgets it does not fail loudly — it fails as a 403 that looks like a
 * refusal, which is why the two classes of header are handled together here
 * rather than left to each route.
 */
export function forwardedHeaders(request: Request): Headers {
  const out = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      out.set(name, value);
    }
  }
  // Proves the identity headers above came through THIS proxy, which sits
  // behind authentik forward-auth, rather than being typed by hand.
  //
  // The service accepts the shared face key from satellites, camera-events,
  // scripts and anything else on the LAN, so if the key alone were enough to
  // make `x-authentik-username` believable, any key holder could clear a
  // lockout with `-H "X-authentik-username: anyone"`. One credential may not
  // vouch for two different things. `NOVA_FACE_PROXY_SECRET` is a separate
  // value held only here; the service refuses identity headers that arrive
  // without it. Absent here, admin routes 403 rather than silently degrading
  // to key-only trust.
  const proxySecret = process.env.NOVA_FACE_PROXY_SECRET;
  if (proxySecret) {
    out.set("X-Nova-Face-Proxy", proxySecret);
  }
  return out;
}

/**
 * Fetch against the face service with the key attached.
 *
 * `init.headers` is merged first so a caller can set `Content-Type` etc., and
 * the key is written last so no caller can override or unset it.
 */
export async function faceAuthFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Nova-Face-Key", faceAuthKey());
  const controller = new AbortController();
  // Longer than the camera-events 15 s: a clip decode on the CPU provider (the
  // documented GPU-busy fallback) is seconds, and timing out a legitimate slow
  // verify would look to the user exactly like a refusal.
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${FACE_AUTH_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(error: unknown): Response {
  if (error instanceof FaceAuthKeyMissingError) {
    return Response.json(
      { error: error.message, reason: SERVICE_UNAVAILABLE },
      { status: 503, headers: NO_STORE },
    );
  }
  return Response.json(
    {
      error: error instanceof Error ? error.message : "Face service unavailable",
      reason: SERVICE_UNAVAILABLE,
    },
    { status: 503, headers: NO_STORE },
  );
}

/** Forward status and body verbatim, so the spec's `reason` strings reach the UI. */
export async function proxyFaceAuthJson(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await faceAuthFetch(path, init);
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        ...NO_STORE,
      },
    });
  } catch (error) {
    return unavailable(error);
  }
}

/** Same, for a binary body. Streams rather than buffering. */
export async function proxyFaceAuthBinary(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await faceAuthFetch(path, init);
    const headers = new Headers(NO_STORE);
    const contentType = response.headers.get("content-type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * Stream an incoming multipart upload straight through to the face service.
 *
 * The body is passed as the request's own `ReadableStream` rather than being
 * parsed into a `FormData` and re-encoded. `FACE_CLIP_MAX_BYTES` is 8 MiB and
 * re-encoding would hold the whole clip — plus a base64-inflated copy of it —
 * in the dashboard process for the life of the upload. The service enforces the
 * size bound itself, before it reads the body, which is where that check
 * belongs.
 *
 * `duplex: "half"` is required by undici whenever the body is a stream; it is
 * not in the DOM `RequestInit` type, hence the cast.
 */
export async function proxyFaceAuthUpload(path: string, request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    return Response.json(
      { error: "Expected a multipart/form-data body", reason: "bad_request" },
      { status: 400, headers: NO_STORE },
    );
  }
  const headers = forwardedHeaders(request);
  headers.set("Content-Type", contentType);
  // Content-Length is deliberately NOT copied. It is client-supplied, and this
  // hop re-frames the request around a `ReadableStream` the proxy never
  // measures: undici would frame the outbound request by the header, so an
  // understated value truncates the clip (surfacing upstream as a confusing
  // `clip_undecodable` rather than a clear 413) and an overstated one stalls
  // until the abort. Letting undici choose the framing keeps the two in step.
  // The service enforces the real 8 MiB bound with a capped streamed read,
  // which is where a size check belongs — a header the sender controls was
  // never going to be that check.
  return proxyFaceAuthJson(path, {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit);
}
