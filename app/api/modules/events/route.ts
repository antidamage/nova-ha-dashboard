import { NextResponse } from "next/server";
import { emitModuleEvent } from "../../../../lib/modules/runtime/hooks";
import { EVENT_IDS, type EventId, type ModuleEvent } from "../../../../lib/modules/runtime/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Client → server hook forwarding (`specs/module-system.md` §3.3).
 *
 * Client-originated events are advisory; the server-side emitters are the
 * authority for anything that must fire with no browser open. `source` is
 * stamped here rather than trusted from the body, so a forwarded event can
 * never claim to be a server one.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ModuleEvent>;
    if (typeof body.id !== "string" || !(EVENT_IDS as readonly string[]).includes(body.id)) {
      return NextResponse.json({ error: "Unknown event id" }, { status: 400 });
    }
    emitModuleEvent({
      ...body,
      id: body.id as EventId,
      at: typeof body.at === "string" ? body.at : new Date().toISOString(),
      source: "client",
    });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to forward event" },
      { status: 400 },
    );
  }
}
