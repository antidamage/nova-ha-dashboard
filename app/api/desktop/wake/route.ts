import { NextResponse } from "next/server";
import { parseDesktopWakeRequest } from "../../../../lib/api/dashboard-requests";
import { wakeDesktop } from "../../../../lib/desktop-wake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { id } = parseDesktopWakeRequest(await request.json());
    const result = await wakeDesktop(id);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Desktop wake action failed" },
      { status: 400 },
    );
  }
}
