import { NextResponse } from "next/server";
import { parseDesktopShutdownRequest } from "../../../../lib/api/dashboard-requests";
import { shutdownManagedComputer } from "../../../../lib/managed-computers";
import { attributeControl } from "../../../../lib/control-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Full power-off of a managed computer (specs/system-power-controls.md, the
// Computers panel section). Terminal and fire-and-forget, like sleep.
export async function POST(request: Request) {
  try {
    const { id } = parseDesktopShutdownRequest(await request.json());
    const result = await shutdownManagedComputer(id);
    void attributeControl(request, {
      service: "system",
      event: "desktop-shutdown",
      summary: `${id} shut down`,
      detail: { route: "/api/desktop/shutdown", id },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Desktop shut down failed" },
      { status: 400 },
    );
  }
}
