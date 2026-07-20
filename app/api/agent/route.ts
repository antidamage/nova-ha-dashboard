import { NextResponse } from "next/server";
import {
  normalizeAgentSettings,
  parseAgentSettingsUpdate,
} from "../../../lib/agent-settings";
import { triggerIridiumVoiceSettingsRefresh } from "../../../lib/iridium-voice-settings";
import { mergeDashboardPreferences, readDashboardPreferences } from "../../../lib/preferences";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const preferences = await readDashboardPreferences();
    return NextResponse.json({ agent: normalizeAgentSettings(preferences.agent) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read agent settings" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const update = parseAgentSettingsUpdate(await request.json());
    await mergeDashboardPreferences({ agent: update });
    // The voice server collects both Voice and Agent settings on the same live
    // refresh signal, avoiding a restart and keeping one authoritative snapshot.
    const iridium = await triggerIridiumVoiceSettingsRefresh();
    const saved = await readDashboardPreferences();
    return NextResponse.json({
      agent: normalizeAgentSettings(saved.agent),
      iridium,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update agent settings" },
      { status: 400 },
    );
  }
}
