"use client";

import { Check } from "lucide-react";
import { VOICE_SETTINGS_RANGES, WEB_BACKENDS } from "../../../../lib/voice-settings";
import { SliderControlPanel } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { SwitchRow } from "../../SlideSwitch";
import type { VoicePipelineController } from "./useVoicePipelineSettings";

// Speaker personalization, voice training, noise gate and web access switches.
export function PipelineCaptureWebSection({ pipeline }: { pipeline: VoicePipelineController }) {
  const { agentName, settings, setSettings, draggingRef, markInteraction, commit } = pipeline;

  return (
    <>
      <div className="grid gap-1.5">
        <SwitchRow
          checked={settings.speakerRecognitionEnabled}
          label="Speaker personalization"
          detail={
            settings.speakerRecognitionEnabled
              ? "On: learn local voice templates from addressed turns and personalize recognized speakers"
              : "Off: do not extract, learn, or match household voice templates"
          }
          onChange={(checked) => void commit("speakerRecognitionEnabled", checked)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Enrollment is local and transparent. Nova stores voice embeddings, never enrollment audio;
          unnamed templates expire after 30 days.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SwitchRow
          checked={settings.voiceTrainingEnabled}
          label="Voice training"
          detail={
            settings.voiceTrainingEnabled
              ? "On: unknown voices may wake and command, and every turn refines recognition"
              : "Off: only recognized household voices are heard"
          }
          onChange={(checked) => void commit("voiceTrainingEnabled", checked)}
        />
      </div>

      <div className="grid gap-1.5">
        <SwitchRow
          checked={settings.satelliteNoiseGateEnabled}
          label="Satellite noise gate"
          detail={
            settings.satelliteNoiseGateEnabled
              ? "On: satellites send probable speech with protected pre-roll and silence tail"
              : "Off for testing: satellites transmit every captured 20 ms audio frame"
          }
          onChange={(checked) => void commit("satelliteNoiseGateEnabled", checked)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Runs locally on each native satellite before network transmission. Turn it off to bypass
          the noise/activity step completely while comparing capture and transcription behavior.
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="mt-2 text-xs font-black uppercase text-neutral-400">Web access</p>
        <SwitchRow
          checked={settings.webAccessEnabled}
          label="Look things up online"
          detail={
            settings.webAccessEnabled
              ? `On: when a request needs current or external facts, ${agentName} rewrites it into a query and answers from the web`
              : `Off: ${agentName} answers only from on-device knowledge and household state`
          }
          onChange={(checked) => void commit("webAccessEnabled", checked)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          The only feature that sends anything off your local network: just the rewritten search
          query (never audio, {agentName}&apos;s personality, or household state), and only on a
          wake-word or follow-up turn. The web API key lives on the voice server, never in the
          dashboard.
        </p>
      </div>

      {settings.webAccessEnabled ? (
        <>
          {WEB_BACKENDS.length > 1 ? (
            <div className="grid gap-1.5">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Answer source
              </p>
              <div role="radiogroup" aria-label="Web answer source" className="grid gap-1.5">
                {WEB_BACKENDS.map((option) => {
                  const active = settings.webBackend === option.value;
                  return (
                    <MomentaryFeedbackButton
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`cyber-checkbox-row border p-4 text-left ${
                        active ? "cyber-checkbox-row-active" : ""
                      }`}
                      onClick={() => void commit("webBackend", option.value)}
                    >
                      <span
                        className={`cyber-checkbox ${active ? "cyber-checkbox-checked" : ""}`}
                        aria-hidden="true"
                      >
                        {active ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
                      </span>
                      <span className="grid min-w-0 gap-1">
                        <span className="theme-display-label zone-title-bar">{option.label}</span>
                        <span className="theme-display-detail">{option.detail}</span>
                      </span>
                    </MomentaryFeedbackButton>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <SliderControlPanel
              ariaLabel="Web answer length"
              ariaValueText={`${settings.webAnswerMaxSentences} sentences`}
              color={[120, 180, 255]}
              intensity={100}
              label="Web answer length"
              max={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.max}
              min={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.min}
              step={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.step}
              value={settings.webAnswerMaxSentences}
              valueText={`${settings.webAnswerMaxSentences} sentence${
                settings.webAnswerMaxSentences === 1 ? "" : "s"
              }`}
              onPreview={(webAnswerMaxSentences) => {
                draggingRef.current.add("webAnswerMaxSentences");
                markInteraction();
                setSettings((current) => ({ ...current, webAnswerMaxSentences }));
              }}
              onCommit={(webAnswerMaxSentences) =>
                void commit("webAnswerMaxSentences", webAnswerMaxSentences)}
            />
            <p className="px-1 text-xs leading-snug text-neutral-500">
              How long a spoken web answer may run. Device control replies stay terse; this only
              lengthens answers {agentName} looks up online.
            </p>
          </div>
        </>
      ) : null}
    </>
  );
}
