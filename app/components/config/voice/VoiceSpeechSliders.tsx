"use client";

import { VOICE_SETTINGS_RANGES } from "../../../../lib/voice-settings";
import { SliderControlPanel } from "../../ConfigControls";
import type { VoiceAgentController } from "./useVoiceAgentPersonality";

// Speech speed, pitch, emotion response and LLM temperature.
export function VoiceSpeechSliders({ voice }: { voice: VoiceAgentController }) {
  const { agentName, settings, setSettings, draggingRef, commit } = voice;

  return (
    <>
      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Speech speed"
          ariaValueText={`${settings.speechRate} percent`}
          color={[60, 220, 240]}
          intensity={100}
          label="Speech speed"
          max={VOICE_SETTINGS_RANGES.speechRate.max}
          min={VOICE_SETTINGS_RANGES.speechRate.min}
          step={VOICE_SETTINGS_RANGES.speechRate.step}
          value={settings.speechRate}
          valueText={`${settings.speechRate}%`}
          onPreview={(speechRate) => {
            draggingRef.current.add("speechRate");
            setSettings((current) => ({ ...current, speechRate }));
          }}
          onCommit={(speechRate) => void commit("speechRate", speechRate)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">100% is {agentName}&apos;s natural pace.</p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Voice pitch"
          ariaValueText={`${settings.pitch > 0 ? "+" : ""}${settings.pitch} percent`}
          color={[180, 95, 240]}
          fill={false}
          intensity={100}
          label="Pitch"
          markers={[
            { label: "Lower", value: -20 },
            { active: settings.pitch === 0, label: "Natural", value: 0 },
            { label: "Higher", value: 20 },
          ]}
          max={VOICE_SETTINGS_RANGES.pitch.max}
          min={VOICE_SETTINGS_RANGES.pitch.min}
          step={VOICE_SETTINGS_RANGES.pitch.step}
          value={settings.pitch}
          valueText={`${settings.pitch > 0 ? "+" : ""}${settings.pitch}%`}
          onPreview={(pitch) => {
            draggingRef.current.add("pitch");
            setSettings((current) => ({ ...current, pitch }));
          }}
          onCommit={(pitch) => void commit("pitch", pitch)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">Moves the delivery lower or brighter without changing voice.</p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Emotion mirroring strength"
          ariaValueText={`${settings.emotionMirroring} percent`}
          color={[255, 0, 187]}
          intensity={100}
          label="Emotion response"
          max={VOICE_SETTINGS_RANGES.emotionMirroring.max}
          min={VOICE_SETTINGS_RANGES.emotionMirroring.min}
          step={VOICE_SETTINGS_RANGES.emotionMirroring.step}
          value={settings.emotionMirroring}
          valueText={`${settings.emotionMirroring}%`}
          onPreview={(emotionMirroring) => {
            draggingRef.current.add("emotionMirroring");
            setSettings((current) => ({ ...current, emotionMirroring }));
          }}
          onCommit={(emotionMirroring) => void commit("emotionMirroring", emotionMirroring)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          0% stays at the baseline mood; 100% follows detected emotion; 200% heightens it.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Language model temperature"
          ariaValueText={settings.temperature.toFixed(1)}
          color={[240, 160, 60]}
          intensity={100}
          label="LLM temperature"
          max={VOICE_SETTINGS_RANGES.temperature.max}
          min={VOICE_SETTINGS_RANGES.temperature.min}
          step={VOICE_SETTINGS_RANGES.temperature.step}
          value={settings.temperature}
          valueText={settings.temperature.toFixed(1)}
          onPreview={(temperature) => {
            draggingRef.current.add("temperature");
            setSettings((current) => ({ ...current, temperature }));
          }}
          onCommit={(temperature) => void commit("temperature", temperature)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          0.0 keeps spoken replies deterministic and cacheable; higher values vary the phrasing.
        </p>
      </div>
    </>
  );
}
