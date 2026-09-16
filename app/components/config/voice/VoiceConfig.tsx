"use client";

import { AudioLines } from "lucide-react";
import type { VoicePreferences } from "../../../../lib/types";
import { ConfigAccordion } from "../../ConfigControls";
import { TranscriptTemplateControl } from "./TranscriptTemplateControl";
import { useVoiceAgentActions } from "./useVoiceAgentActions";
import { useVoiceAgentPersonality } from "./useVoiceAgentPersonality";
import { useVoiceAgentState } from "./useVoiceAgentState";
import { VoiceEngineSection } from "./VoiceEngineSection";
import { VoicePersonalitySection } from "./VoicePersonalitySection";
import { VoiceReplySliders } from "./VoiceReplySliders";
import { VoiceSpeechSliders } from "./VoiceSpeechSliders";

export function VoiceConfig({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const voiceState = useVoiceAgentState(initialSettings);
  const voiceActions = useVoiceAgentActions(voiceState);
  const voice = useVoiceAgentPersonality(voiceActions);
  const { agentName, optionsSource, settings, commit, message, messageTone } = voice;

  return (
    <ConfigAccordion
      id="voice"
      title="Voice Agent"
      icon={<AudioLines className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Shape the voice agent&apos;s speech and language model with explicit controls. {agentName} stores each
        change, then signals voice host to collect and apply the complete setting set without restarting
        the voice service.
        {optionsSource === "voiceHost" ? " Voice list published live by the voice host." : null}
      </p>

      <VoiceEngineSection voice={voice} />

      <VoicePersonalitySection voice={voice} />

      <div className="grid gap-4">
        <VoiceSpeechSliders voice={voice} />

        <VoiceReplySliders voice={voice} />

        <TranscriptTemplateControl
          agentName={agentName}
          value={settings.transcriptTemplate}
          onCommit={(transcriptTemplate) => void commit("transcriptTemplate", transcriptTemplate)}
        />
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-4 text-sm font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
    </ConfigAccordion>
  );
}
