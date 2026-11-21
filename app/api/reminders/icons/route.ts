import { NextResponse } from "next/server";

import { accessStatus, readAccess, TaskAccessError, type TaskAccess } from "../../../../lib/tasks/access";
import { visibleRosterEntries } from "../../../../lib/tasks/ownership";
import { readTasks } from "../../../../lib/tasks/store";
import type { Task } from "../../../../lib/types";
import {
  deleteReminderIcon,
  ensureReminderIcons,
  patchReminderIcon,
  readReminderIcons,
  reorderReminderIcons,
} from "../../../../lib/reminder-icons";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A viewer may only touch the icon of a name it can see. Anything else answers the same 404
// whether the name belongs to someone else or to nobody, so a guessed name reveals nothing.
function requireVisibleKey(access: TaskAccess, tasks: Task[], key: string) {
  if (access.viewer.kind === "system") return;
  if (visibleRosterEntries([{ key }], tasks, access.viewer, access.legacyOwner).length === 0) {
    throw new TaskAccessError(404, "not-found", "Reminder not found");
  }
}

export async function GET(request: Request) {
  try {
    // The roster grows as reminders are written, so one that predates it (or
    // arrived by a path that never assigned an icon) would be missing from the
    // config list. Assign from the live tasks on every read.
    const access = await readAccess(request);
    const tasks = await readTasks();
    await ensureReminderIcons(tasks);
    const entries = visibleRosterEntries(await readReminderIcons(), tasks, access.viewer, access.legacyOwner);
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read reminder icons" },
      { status: accessStatus(error, 500) },
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
      displayName?: unknown;
    };

    const access = await readAccess(request);
    const tasks = await readTasks();
    if (Array.isArray(body.keys)) {
      const keys = body.keys.filter((key): key is string => typeof key === "string");
      keys.forEach((key) => requireVisibleKey(access, tasks, key));
      return NextResponse.json({
        entries: visibleRosterEntries(await reorderReminderIcons(keys), tasks, access.viewer, access.legacyOwner),
      });
    }

    if (typeof body.key !== "string") {
      return NextResponse.json({ error: "A reminder key is required" }, { status: 400 });
    }
    requireVisibleKey(access, tasks, body.key);

    const entry = await patchReminderIcon(body.key, {
      glyph: body.glyph,
      showInBar: body.showInBar,
      order: body.order,
      displayName: body.displayName,
    });

    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update reminder icon" },
      { status: accessStatus(error, 400) },
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

    const access = await readAccess(request);
    const tasks = await readTasks();
    requireVisibleKey(access, tasks, key);
    return NextResponse.json({
      entries: visibleRosterEntries(await deleteReminderIcon(key), tasks, access.viewer, access.legacyOwner),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove reminder icon" },
      { status: accessStatus(error, 400) },
    );
  }
}
