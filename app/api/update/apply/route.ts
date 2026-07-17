import { NextResponse } from "next/server";
import { getUpdateStatus, requestUpdate } from "../../../../lib/update";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    let requestedBy = "api";
    let sha: string | undefined;
    try {
      const body = (await request.json()) as { requestedBy?: string; sha?: string };
      if (typeof body.requestedBy === "string" && body.requestedBy.trim()) {
        requestedBy = body.requestedBy.trim().slice(0, 40);
      }
      if (typeof body.sha === "string" && /^[0-9a-f]{7,40}$/i.test(body.sha.trim())) {
        sha = body.sha.trim();
      }
    } catch {
      // No/invalid body is fine — apply latest branch HEAD.
    }

    const status = await getUpdateStatus();
    if (status.busy) {
      return NextResponse.json(
        { error: `An update is already ${status.phase}.`, status },
        { status: 409 },
      );
    }

    const queued = await requestUpdate({ sha, requestedBy });
    return NextResponse.json({ queued, status: await getUpdateStatus() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue update" },
      { status: 500 },
    );
  }
}
