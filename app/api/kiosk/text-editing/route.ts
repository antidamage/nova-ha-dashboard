import { NextResponse } from "next/server";

/**
 * "Someone is typing into a field right now."
 *
 * The Nocturnium kiosk shows KWin's virtual keyboard when an input takes focus,
 * and `nova-monitoring/kiosk/virtual-keyboard-idle-guard.py` hides it again
 * after ten seconds of touchscreen inactivity. The guard has no way to see
 * focus, so pausing to think mid-entry took the keyboard away. It polls this
 * instead and skips the hide while a field is held.
 *
 * Deliberately in-process and unpersisted: it describes a moment, it is worth
 * nothing after a restart, and the client re-asserts it every few seconds. The
 * TTL is what makes a browser that closed mid-edit release it on its own.
 */

export const dynamic = "force-dynamic";

const TTL_MS = 10_000;

let lastHeartbeat = 0;

export async function GET() {
  return NextResponse.json({ active: Date.now() - lastHeartbeat < TTL_MS });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { active?: boolean } | null;
  lastHeartbeat = body?.active ? Date.now() : 0;
  return NextResponse.json({ active: Boolean(body?.active) });
}
