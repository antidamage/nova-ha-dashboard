import { NextResponse } from "next/server";
import { parseDesktopSleepRequest } from "../../../../lib/api/dashboard-requests";
import { sleepDesktop } from "../../../../lib/desktop-sleep";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { id } = parseDesktopSleepRequest(await request.json());
    const result = await sleepDesktop(id);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Desktop sleep action failed" },
      { status: 400 },
    );
  }
}
