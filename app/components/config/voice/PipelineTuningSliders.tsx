"use client";

import { VOICE_SETTINGS_RANGES } from "../../../../lib/voice-settings";
import { SliderControlPanel } from "../../ConfigControls";
import type { VoicePipelineController } from "./useVoicePipelineSettings";
import { SPEAKER_MATCH_SLIDERS } from "./voice-infrastructure-model";

// Conversation window, playback shaping and speaker-matching sliders.
export function PipelineTuningSliders({ pipeline }: { pipeline: VoicePipelineController }) {
  const { agentName, settings, setSettings, draggingRef, markInteraction, commit } = pipeline;

  return (
    <>
      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Conversation window"
          ariaValueText={`${settings.conversationIdleSeconds} seconds`}
          color={[80, 240, 160]}
          intensity={100}
          label="Conversation window"
          max={VOICE_SETTINGS_RANGES.conversationIdleSeconds.max}
          min={VOICE_SETTINGS_RANGES.conversationIdleSeconds.min}
          step={VOICE_SETTINGS_RANGES.conversationIdleSeconds.step}
          value={settings.conversationIdleSeconds}
          valueText={`${settings.conversationIdleSeconds}s`}
          onPreview={(conversationIdleSeconds) => {
            draggingRef.current.add("conversationIdleSeconds");
            markInteraction();
            setSettings((current) => ({ ...current, conversationIdleSeconds }));
          }}
          onCommit={(conversationIdleSeconds) =>
            void commit("conversationIdleSeconds", conversationIdleSeconds)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How long a conversation stays open after {agentName}&apos;s last turn before the wake
          word is needed again.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Conversation limit"
          ariaValueText={`${settings.conversationMaxSeconds} seconds`}
          color={[80, 240, 160]}
          intensity={100}
          label="Conversation limit"
          max={VOICE_SETTINGS_RANGES.conversationMaxSeconds.max}
          min={VOICE_SETTINGS_RANGES.conversationMaxSeconds.min}
          step={VOICE_SETTINGS_RANGES.conversationMaxSeconds.step}
          value={settings.conversationMaxSeconds}
          valueText={`${settings.conversationMaxSeconds}s`}
          onPreview={(conversationMaxSeconds) => {
            draggingRef.current.add("conversationMaxSeconds");
            markInteraction();
            setSettings((current) => ({ ...current, conversationMaxSeconds }));
          }}
          onCommit={(conversationMaxSeconds) =>
            void commit("conversationMaxSeconds", conversationMaxSeconds)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Longest a conversation may run before the wake word is needed again, however much is
          said.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Playback preroll"
          ariaValueText={`${settings.ttsPrerollMs} milliseconds`}
          color={[240, 100, 100]}
          intensity={100}
          label="Playback preroll"
          max={VOICE_SETTINGS_RANGES.ttsPrerollMs.max}
          min={VOICE_SETTINGS_RANGES.ttsPrerollMs.min}
          step={VOICE_SETTINGS_RANGES.ttsPrerollMs.step}
          value={settings.ttsPrerollMs}
          valueText={`${settings.ttsPrerollMs}ms`}
          onPreview={(ttsPrerollMs) => {
            draggingRef.current.add("ttsPrerollMs");
            markInteraction();
            setSettings((current) => ({ ...current, ttsPrerollMs }));
          }}
          onCommit={(ttsPrerollMs) => void commit("ttsPrerollMs", ttsPrerollMs)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How much audio a satellite buffers before it starts speaking. Lower starts responses
          sooner; raise it if replies start to stutter.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Audio frame size"
          ariaValueText={`${settings.ttsFrameMs} milliseconds`}
          color={[255, 140, 60]}
          intensity={100}
          label="Audio frame size"
          max={VOICE_SETTINGS_RANGES.ttsFrameMs.max}
          min={VOICE_SETTINGS_RANGES.ttsFrameMs.min}
          step={VOICE_SETTINGS_RANGES.ttsFrameMs.step}
          value={settings.ttsFrameMs}
          valueText={`${settings.ttsFrameMs}ms`}
          onPreview={(ttsFrameMs) => {
            draggingRef.current.add("ttsFrameMs");
            markInteraction();
            setSettings((current) => ({ ...current, ttsFrameMs }));
          }}
          onCommit={(ttsFrameMs) => void commit("ttsFrameMs", ttsFrameMs)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Size of the steady-state audio chunks sent to satellites after the first. Smaller
          trades a little network overhead for smoother pacing.
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="mt-2 text-xs font-black uppercase text-neutral-400">Speaker matching</p>
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How readily {agentName} treats a voice as an already-known person. These are cosine-similarity
          thresholds (0–1) on the local TitaNet voice embeddings. Loosen them when one person is being
          split into a new profile across different microphones, rooms, and distances; tighten them if
          different people start getting mixed up. The tick on each slider marks the default — drag near
          it to snap back.
        </p>
      </div>

      {SPEAKER_MATCH_SLIDERS.map((slider) => {
        const range = VOICE_SETTINGS_RANGES[slider.key];
        const current = settings[slider.key];
        return (
          <div key={slider.key} className="grid gap-1.5">
            <SliderControlPanel
              ariaLabel={slider.label}
              ariaValueText={current.toFixed(2)}
              color={slider.color}
              intensity={100}
              label={slider.label}
              max={range.max}
              min={range.min}
              step={range.step}
              markers={[{
                value: range.default,
                label: `default ${range.default.toFixed(2)}`,
                active: current === range.default,
              }]}
              snapValue={range.default}
              value={current}
              valueText={current.toFixed(2)}
              onPreview={(next) => {
                draggingRef.current.add(slider.key);
                markInteraction();
                setSettings((currentSettings) => ({ ...currentSettings, [slider.key]: next }));
              }}
              onCommit={(next) => void commit(slider.key, next)}
            />
            <p className="px-1 text-xs leading-snug text-neutral-500">{slider.note}</p>
          </div>
        );
      })}
    </>
  );
}
