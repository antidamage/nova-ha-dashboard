import { NextResponse } from "next/server";

import {
  deleteReminderIcon,
  patchReminderIcon,
  readReminderIcons,
  reorderReminderIcons,
} from "../../../../lib/reminder-icons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ entries: await readReminderIcons() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read reminder icons" },
      { status: 500 },
    );
  }
}

// PATCH does double duty: `{ keys: [...] }` commits a reordering from the
// config list's move controls, `{ key, ... }` edits one assignment. Keeping
// them on one route means one SSE republish per user gesture either way.
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      key?: unknown;
      keys?: unknown;
      glyph?: unknown;
      showInBar?: unknown;
      order?: unknown;
    };

    if (Array.isArray(body.keys)) {
      const keys = body.keys.filter((key): key is string => typeof key === "string");
      return NextResponse.json({ entries: await reorderReminderIcons(keys) });
    }

    if (typeof body.key !== "string") {
      return NextResponse.json({ error: "A reminder key is required" }, { status: 400 });
    }

    const entry = await patchReminderIcon(body.key, {
      glyph: body.glyph,
      showInBar: body.showInBar,
      order: body.order,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update reminder icon" },
      { status: 400 },
    );
  }
}

// Forget a reminder's sigil. The roster grows by observation — every reminder
// ever created leaves an entry — so there has to be a way to drop one whose
// reminder is gone for good.
export async function DELETE(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "A reminder key is required" }, { status: 400 });
    }

    return NextResponse.json({ entries: await deleteReminderIcon(key) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove reminder icon" },
      { status: 400 },
    );
  }
}
