import { NextResponse } from "next/server";
import { getUpdateStatus, requestRollback } from "../../../../lib/update";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let requestedBy = "api";
    try {
      const body = (await request.json()) as { requestedBy?: string };
      if (typeof body.requestedBy === "string" && body.requestedBy.trim()) {
        requestedBy = body.requestedBy.trim().slice(0, 40);
      }
    } catch {
      // No body is fine.
    }

    const status = await getUpdateStatus();
    if (status.busy) {
      return NextResponse.json(
        { error: `An update is already ${status.phase}.`, status },
        { status: 409 },
      );
    }
    if (!status.canRollback) {
      return NextResponse.json(
        { error: "No previous version is available to roll back to.", status },
        { status: 409 },
      );
    }

    const queued = await requestRollback({ requestedBy });
    return NextResponse.json({ queued, status: await getUpdateStatus() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue rollback" },
      { status: 500 },
    );
  }
}
