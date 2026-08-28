import { NextResponse } from "next/server";
import { findModuleRoute } from "../../../../../lib/modules/runtime/loader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Routes a module serves for itself (`specs/module-system.md` §8), for when it
 * must be reachable from outside the dashboard's own UI. Static siblings
 * (`config`, `download`, `client.mjs`) take precedence, so a module cannot
 * shadow the management API.
 *
 * Handlers get a stripped context — parsed body, query, headers — rather than
 * the raw request, so a module never holds the connection itself.
 */
async function dispatch(
  request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: segments } = await params;
  const handler = findModuleRoute(id, request.method, segments);
  if (!handler) {
    return NextResponse.json({ error: "No such module route" }, { status: 404 });
  }

  let body: unknown;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.json().catch(() => undefined);
  }

  try {
    const result = await handler({
      method: request.method,
      pathSegments: segments,
      query: Object.fromEntries(new URL(request.url).searchParams),
      headers: Object.fromEntries(request.headers),
      body,
    });
    return NextResponse.json(result?.body ?? {}, { status: result?.status ?? 200 });
  } catch (error) {
    console.error(`[nova-modules] ${id} route ${request.method} /${segments.join("/")} threw`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Module route failed" },
      { status: 500 },
    );
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const PUT = dispatch;
export const DELETE = dispatch;
