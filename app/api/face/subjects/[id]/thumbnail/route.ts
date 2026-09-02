import { forwardedHeaders, proxyFaceAuthBinary } from "../../../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * The one 256 px thumbnail kept per subject for the gallery UI.
 *
 * It goes through the proxy rather than being fetched directly because the
 * service requires `X-Nova-Face-Key` on every endpoint, and an `<img src>` the
 * browser issues cannot carry a header the browser must never hold.
 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "Subject id is required" }, { status: 400 });
  }
  // The thumbnail IS the biometric. It carries the identity headers for the
  // same reason the listing does -- this must never be a route that serves a
  // household member's face to an unauthenticated caller.
  return proxyFaceAuthBinary(`/subjects/${encodeURIComponent(id)}/thumbnail`, {
    headers: forwardedHeaders(request),
  });
}
