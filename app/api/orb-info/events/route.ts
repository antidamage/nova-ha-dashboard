import { NextResponse } from "next/server";
import { readOrbEvents } from "../../../../lib/orb-info/events";
import { parseOrbInfoUpdateRequest } from "../../../../lib/api/dashboard-requests";
import { readDashboardPreferences } from "../../../../lib/preferences";
import { resolveOrbEntries } from "../../../../lib/orb-info/preferences";
export const dynamic = "force-dynamic";
export async function GET() {
  const settings = await readDashboardPreferences();
  const entries = resolveOrbEntries(settings.orbInfo);
  return NextResponse.json({ entries, outputs: await readOrbEvents(entries), timer: await (await import("../../../../lib/orb-timer")).readOrbTimer() });
}
export async function POST(request: Request) {
  try {
    const settings = parseOrbInfoUpdateRequest(await request.json());
    return NextResponse.json({ outputs: await readOrbEvents(resolveOrbEntries(settings)) });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}
