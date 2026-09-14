import { NextResponse } from "next/server";
import { claimOrbTimerSound, dismissOrbTimer, readOrbTimer, setOrbTimer } from "../../../lib/orb-timer";
import { readDashboardPreferences } from "../../../lib/preferences";
import { resolveOrbEntries } from "../../../lib/orb-info/preferences";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ timer: await readOrbTimer() }); }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.command === "dismiss" && typeof body.id === "string") return NextResponse.json({ timer: await dismissOrbTimer(body.id) });
    if (body.command === "chime" && typeof body.id === "string" && Number.isInteger(body.slot)) {
      const preferences = await readDashboardPreferences();
      const repeat = resolveOrbEntries(preferences.orbInfo).some((entry) => entry.moduleId === "timer");
      return NextResponse.json({ claimed: await claimOrbTimerSound(body.id, body.slot, repeat) });
    }
    if (body.command !== "set" || typeof body.durationMs !== "number" || typeof body.icon !== "string" || !body.icon || body.icon.length > 200 || typeof body.label !== "string" || !body.label || body.label.length > 80) throw new Error("Invalid timer command");
    return NextResponse.json({ timer: await setOrbTimer(body.durationMs, body.icon, body.label) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Timer command failed" }, { status: 400 }); }
}
