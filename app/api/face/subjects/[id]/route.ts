import { forwardedHeaders, proxyFaceAuthJson } from "../../../../../lib/face-auth-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** Removes the subject, its embeddings and its credential. Credential-destroying, so gated. */
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "Subject id is required" }, { status: 400 });
  }
  return proxyFaceAuthJson(`/subjects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: forwardedHeaders(request),
  });
}
