import { NextResponse } from "next/server";
import { accessStatus, readAccess, TaskAccessError } from "../../../../lib/tasks/access";
import { readUserPrefs, writeUserPrefs } from "../../../../lib/tasks/user-prefs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The viewer's own reminder preferences (specs/private-reminders.md, section 6).
// A household or undecided viewer reads the default and cannot write.
export async function GET(request: Request) {
  try {
    const { viewer } = await readAccess(request);
    return NextResponse.json(viewer.kind === "user" ? await readUserPrefs(viewer.id) : { chime: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read preferences" },
      { status: accessStatus(error, 500) },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const { viewer } = await readAccess(request);
    if (viewer.kind !== "user") {
      throw new TaskAccessError(403, "choose-a-user", "Choose who you are to change your preferences");
    }
    const body = (await request.json().catch(() => ({}))) as { chime?: unknown };
    if (typeof body.chime !== "boolean") {
      throw new TaskAccessError(400, "bad-request", "chime must be true or false");
    }
    return NextResponse.json(await writeUserPrefs(viewer.id, { chime: body.chime }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save preferences" },
      { status: accessStatus(error, 400) },
    );
  }
}