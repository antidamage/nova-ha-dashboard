"use client";

import { VOICE_SETTINGS_RANGES } from "../../../../lib/voice-settings";
import { SliderControlPanel } from "../../ConfigControls";
import type { VoiceAgentController } from "./useVoiceAgentPersonality";

// Reply length, command reply bounds, and day/night volume.
export function VoiceReplySliders({ voice }: { voice: VoiceAgentController }) {
  const { settings, setSettings, draggingRef, commit } = voice;

  return (
    <>
      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Long response probability"
          ariaValueText={`${Math.round(settings.longResponseProbability * 100)} percent`}
          color={[240, 160, 60]}
          intensity={100}
          label="Long responses"
          max={VOICE_SETTINGS_RANGES.longResponseProbability.max}
          min={VOICE_SETTINGS_RANGES.longResponseProbability.min}
          step={VOICE_SETTINGS_RANGES.longResponseProbability.step}
          value={settings.longResponseProbability}
          valueText={settings.longResponseProbability.toFixed(2)}
          onPreview={(longResponseProbability) => {
            draggingRef.current.add("longResponseProbability");
            setSettings((current) => ({ ...current, longResponseProbability }));
          }}
          onCommit={(longResponseProbability) =>
            void commit("longResponseProbability", longResponseProbability)
          }
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Chance a spoken reply runs two to four sentences instead of one; 0.00 keeps every
          reply short.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Command reply minimum words"
          ariaValueText={
            settings.commandReplyMinWords === 0
              ? "no minimum"
              : `at least ${settings.commandReplyMinWords} words`
          }
          color={[240, 160, 60]}
          intensity={100}
          label="Command reply minimum length"
          max={VOICE_SETTINGS_RANGES.commandReplyMinWords.max}
          min={VOICE_SETTINGS_RANGES.commandReplyMinWords.min}
          step={VOICE_SETTINGS_RANGES.commandReplyMinWords.step}
          value={settings.commandReplyMinWords}
          valueText={
            settings.commandReplyMinWords === 0 ? "None" : `≥${settings.commandReplyMinWords}`
          }
          onPreview={(commandReplyMinWords) => {
            draggingRef.current.add("commandReplyMinWords");
            setSettings((current) => ({ ...current, commandReplyMinWords }));
          }}
          onCommit={(commandReplyMinWords) =>
            void commit("commandReplyMinWords", commandReplyMinWords)
          }
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Guarantees every command acknowledgement is at least this many words — raise above 0
          to stop silent completions, which are easy to mistake for no response during
          development. 0 allows the occasional silent confirmation.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Command reply maximum words"
          ariaValueText={
            settings.commandReplyMaxWords === 0
              ? "silent"
              : `up to ${settings.commandReplyMaxWords} words`
          }
          color={[240, 160, 60]}
          intensity={100}
          label="Command reply maximum length"
          max={VOICE_SETTINGS_RANGES.commandReplyMaxWords.max}
          min={VOICE_SETTINGS_RANGES.commandReplyMaxWords.min}
          step={VOICE_SETTINGS_RANGES.commandReplyMaxWords.step}
          value={settings.commandReplyMaxWords}
          valueText={
            settings.commandReplyMaxWords === 0
              ? "Silent"
              : `≤${settings.commandReplyMaxWords}`
          }
          onPreview={(commandReplyMaxWords) => {
            draggingRef.current.add("commandReplyMaxWords");
            setSettings((current) => ({ ...current, commandReplyMaxWords }));
          }}
          onCommit={(commandReplyMaxWords) =>
            void commit("commandReplyMaxWords", commandReplyMaxWords)
          }
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Maximum spoken words when confirming a command; the actual length is rolled randomly
          between the minimum above and this each time.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Daytime voice volume"
          ariaValueText={`${settings.volumeDay} percent`}
          color={[255, 200, 60]}
          intensity={100}
          label="Daytime volume"
          max={VOICE_SETTINGS_RANGES.volumeDay.max}
          min={VOICE_SETTINGS_RANGES.volumeDay.min}
          step={VOICE_SETTINGS_RANGES.volumeDay.step}
          value={settings.volumeDay}
          valueText={`${settings.volumeDay}%`}
          onPreview={(volumeDay) => {
            draggingRef.current.add("volumeDay");
            setSettings((current) => ({ ...current, volumeDay }));
          }}
          onCommit={(volumeDay) => void commit("volumeDay", volumeDay)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Playback loudness for spoken responses from 8 am to 9 pm.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Nighttime voice volume"
          ariaValueText={`${settings.volumeNight} percent`}
          color={[110, 130, 255]}
          intensity={100}
          label="Nighttime volume"
          max={VOICE_SETTINGS_RANGES.volumeNight.max}
          min={VOICE_SETTINGS_RANGES.volumeNight.min}
          step={VOICE_SETTINGS_RANGES.volumeNight.step}
          value={settings.volumeNight}
          valueText={`${settings.volumeNight}%`}
          onPreview={(volumeNight) => {
            draggingRef.current.add("volumeNight");
            setSettings((current) => ({ ...current, volumeNight }));
          }}
          onCommit={(volumeNight) => void commit("volumeNight", volumeNight)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Playback loudness for spoken responses from 9 pm to 8 am, so overnight replies stay quiet.
        </p>
      </div>
    </>
  );
}
