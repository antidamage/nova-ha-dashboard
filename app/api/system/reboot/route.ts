import { NextResponse } from "next/server";
import { requestSystemAction } from "../../../../lib/system-control";

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
      // No/invalid body is fine.
    }

    const queued = await requestSystemAction("reboot-host", { requestedBy });
    return NextResponse.json({ queued });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue host reboot" },
      { status: 500 },
    );
  }
}
