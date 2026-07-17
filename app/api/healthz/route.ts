import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Minimal liveness probe for the global SystemActivityBlocker and the kiosk.
// Deliberately does NOTHING but confirm the Next.js server can answer: no Home
// Assistant call, no GitHub/update check, no filesystem read. If this returns
// 200 the dashboard process is alive, so the blocker must not show "Reconnecting
// to Nova" just because the heavier /api/update was briefly slow. Keep it cheap.
export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
