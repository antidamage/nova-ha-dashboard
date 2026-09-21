import { NextResponse } from "next/server";
import { setAmpAutomation } from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Set the amp's two switches — the Grid panel's "Auto On" and "Auto Off"
 * checkboxes (specs/amp-appletv-power.md §7).
 *
 * Both are always sent, and a body missing either is refused rather than
 * merged: the panel holds both values, so a partial write would only be a way
 * to leave one of them at whatever the request happened to think it was.
 *
 * This is a preference the household keeps, so it goes into the power state
 * beside the active category rather than into config, which is deployed. The
 * controller reads it on its next tick, five seconds away, and takes, keeps or
 * releases the plug accordingly.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { autoOff?: unknown; autoOn?: unknown };
    if (typeof body.autoOn !== "boolean" || typeof body.autoOff !== "boolean") {
      return NextResponse.json(
        { error: "autoOn and autoOff must both be booleans" },
        { status: 400 },
      );
    }
    const state = await setAmpAutomation({ autoOff: body.autoOff, autoOn: body.autoOn });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set the amp automation" },
      { status: 400 },
    );
  }
}
