import { NextResponse } from "next/server";
import { relayIridiumTraining } from "../../../../../lib/iridium-voice-settings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

// Catch-all relay for the voice-training API, so the Voice Training panel talks
// to one dashboard origin instead of reaching the voice host directly (which it
// cannot: the voice server is mTLS-protected and only the dashboard holds the
// client identity).
//
// Every training endpoint is proxied verbatim rather than modelled here. The
// voice server owns the contract, validates the requests, and writes its error
// messages for a human to read -- re-stating any of that in the dashboard would
// only create a second thing to keep in sync.
function target(path: string[] | undefined, search: string): string {
  const suffix = (path ?? []).map(encodeURIComponent).join("/");
  return `/v1/training${suffix ? `/${suffix}` : ""}${search}`;
}

function respond(result: Awaited<ReturnType<typeof relayIridiumTraining>>) {
  return new NextResponse(result.body, {
    status: result.status,
    headers: { "content-type": result.contentType },
  });
}

export async function GET(request: Request, context: Context) {
  const { path } = await context.params;
  const search = new URL(request.url).search;
  return respond(await relayIridiumTraining(target(path, search), { method: "GET", timeoutMs: 15_000 }));
}

export async function POST(request: Request, context: Context) {
  const { path } = await context.params;
  const contentType = request.headers.get("content-type") ?? "";
  const raw = Buffer.from(await request.arrayBuffer());
  // Sample uploads are large multipart bodies; control calls are small JSON.
  // Both are forwarded byte-for-byte with their original content-type.
  const body = raw.length > 0 ? raw : Buffer.from("{}");
  return respond(
    await relayIridiumTraining(target(path, ""), {
      method: "POST",
      body,
      contentType: contentType || "application/json",
      // Uploading a hundred samples takes a while; training itself is started
      // asynchronously by the server, so no request here waits on a training run.
      timeoutMs: 600_000,
    }),
  );
}

export async function DELETE(_request: Request, context: Context) {
  const { path } = await context.params;
  return respond(await relayIridiumTraining(target(path, ""), { method: "DELETE", timeoutMs: 30_000 }));
}
