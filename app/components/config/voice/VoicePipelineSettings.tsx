"use client";

import type { VoicePreferences } from "../../../../lib/types";
import { PipelineCaptureWebSection } from "./PipelineCaptureWebSection";
import { PipelineCompanionSection } from "./PipelineCompanionSection";
import { PipelineTuningSliders } from "./PipelineTuningSliders";
import { useVoicePipelineSettings } from "./useVoicePipelineSettings";

// Global voice-pipeline tuning: the conversation window plus the satellite audio
// playback shaping (preroll and frame size). These are infrastructure knobs, not
// personality — they sit at the bottom of Voice Infrastructure rather than in the
// Voice Agent card. Each change POSTs the single field to /api/voice (which then
// notifies VoiceHost), exactly like the Voice Agent controls; the two sections edit
// disjoint fields so their independent polls never fight.
export function VoicePipelineSettings({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const pipeline = useVoicePipelineSettings(initialSettings);
  const { message, messageTone } = pipeline;

  return (
    <div className="grid gap-4">
      <p className="text-xs font-black uppercase text-neutral-400">Capture, Conversation &amp; Playback</p>

      <PipelineCaptureWebSection pipeline={pipeline} />

      <PipelineCompanionSection pipeline={pipeline} />

      <PipelineTuningSliders pipeline={pipeline} />

      {message ? (
        <p
          role="status"
          className={`text-sm font-semibold ${
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
    </div>
  );
}
