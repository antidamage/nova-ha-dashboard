import { NextResponse } from "next/server";
import { setAmpAutomationEnabled } from "../../../../lib/power";

export const dynamic = "force-dynamic";

/**
 * Switch the amp's follow-the-Apple-TV automation on or off — the Grid panel's
 * "Automate state" checkbox (specs/amp-appletv-power.md §7).
 *
 * This is a preference the household keeps, so it goes into the power state
 * beside the active category rather than into config, which is deployed. The
 * controller reads it on its next tick, five seconds away, and takes or
 * releases the plug accordingly.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const state = await setAmpAutomationEnabled(body.enabled);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set the amp automation" },
      { status: 400 },
    );
  }
}
