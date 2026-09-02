import { proxyFaceAuthUpload } from "../../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ subject: string }> };

/**
 * One enrolment clip: multipart `clip` + `nonce`.
 *
 * Registering a face issues a credential, so this is behind authentik
 * forward-auth at the Caddy layer, tailnet origin only. The body streams
 * through untouched — see `proxyFaceAuthUpload` for why it is not re-encoded.
 *
 * The reply is the progress record the UI renders:
 * `{ accepted, clipsSoFar, needed, remaining, consistency, reason? }`. A
 * rejected clip leaves `clipsSoFar` unchanged, which is why the UI counts from
 * this response rather than from a client-side counter.
 */
export async function POST(request: Request, context: Context) {
  const { subject } = await context.params;
  if (!subject) {
    return Response.json({ error: "Subject is required" }, { status: 400 });
  }
  return proxyFaceAuthUpload(`/enrol/${encodeURIComponent(subject)}`, request);
}
