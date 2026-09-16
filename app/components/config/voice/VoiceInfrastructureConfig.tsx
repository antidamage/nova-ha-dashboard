"use client";

import { RadioTower } from "lucide-react";
import type { VoicePreferences } from "../../../../lib/types";
import { ConfigAccordion } from "../../ConfigControls";
import { VoiceServerStatus } from "../../VoiceServerStatus";
import { EngineVoicesPanel } from "./EngineVoicesPanel";
import { SatellitePanel } from "./SatellitePanel";
import { VoiceKillswitch } from "./VoiceKillswitch";
import { VoicePipelineSettings } from "./VoicePipelineSettings";

// Health-and-connectivity section for the voice stack: the voice server's own
// reachability and every satellite that captures speech and plays responses,
// plus the global voice-pipeline tuning (conversation window and playback
// shaping) at the bottom. Kept as its own accordion above Voice Agent so the
// personality settings are not crowded by live status that polls on its own
// cadence.
export function VoiceInfrastructureConfig({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  return (
    <ConfigAccordion
      id="voice-infrastructure"
      title="Voice Infrastructure"
      icon={<RadioTower className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Live health of the voice server and the satellites that capture speech and play responses.
        Expand to check reachability or reconnect a satellite that has dropped off.
      </p>

      <VoiceKillswitch initialSettings={initialSettings} />

      <div className="mb-4">
        <VoiceServerStatus />
      </div>
      <SatellitePanel />
      <EngineVoicesPanel />
      <VoicePipelineSettings initialSettings={initialSettings} />
    </ConfigAccordion>
  );
}
