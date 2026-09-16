"use client";

import { Check } from "lucide-react";
import { VOICE_ENGINES, VOICE_SETTINGS_RANGES } from "../../../../lib/voice-settings";
import { SliderControlPanel } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { VoiceAgentController } from "./useVoiceAgentPersonality";

// Engine picker with its confirm step, switch progress, and diffusion steps.
export function VoiceEngineSection({ voice }: { voice: VoiceAgentController }) {
  const {
    pendingEngine,
    engine,
    switchInFlight,
    setPendingEngine,
    requestEngineSwitch,
    engineLabel,
    switchNote,
    switchFailed,
    capabilities,
    settings,
    draggingRef,
    markInteraction,
    setSettings,
    commit,
  } = voice;

  return (
    <>
      <div className="mb-4 grid gap-1.5">
        <p className="text-xs font-black uppercase text-neutral-400">Voice engine</p>
        <div role="radiogroup" aria-label="Voice engine" className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {VOICE_ENGINES.map((option) => {
            const selected = (pendingEngine ?? engine) === option.value;
            return (
              <MomentaryFeedbackButton
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={switchInFlight}
                className={`cyber-checkbox-row border p-4 text-left ${
                  selected ? "cyber-checkbox-row-active" : ""
                }`}
                onClick={() => setPendingEngine(option.value === engine ? null : option.value)}
              >
                <span
                  className={`cyber-checkbox ${selected ? "cyber-checkbox-checked" : ""}`}
                  aria-hidden="true"
                >
                  {selected ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="theme-display-label zone-title-bar">
                    {option.label}
                    {engine === option.value ? " · active" : ""}
                  </span>
                  <span className="theme-display-detail">{option.detail}</span>
                </span>
              </MomentaryFeedbackButton>
            );
          })}
        </div>
        {pendingEngine !== null && pendingEngine !== engine && !switchInFlight ? (
          <div className="grid gap-2 px-1">
            <p className="font-sans text-xs leading-snug text-amber-200">
              Switching swaps which TTS model is loaded on the voice server and restarts voice
              services: expect no spoken replies for a couple of minutes
              {/* The ~7 minute figure is specifically measured for Custom's optimize=True
                  warmup; other engines' warmup time isn't asserted until measured the same way. */}
              {pendingEngine === "custom" ? ", plus around 7 minutes of Custom-engine warmup" : ""}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="system-confirm-go"
                onClick={() => void requestEngineSwitch(pendingEngine)}
              >
                Switch to {engineLabel(pendingEngine)}
              </button>
              <button
                type="button"
                className="system-confirm-cancel"
                onClick={() => setPendingEngine(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {switchNote ? (
          <p
            role="status"
            className={`px-1 font-sans text-xs leading-snug ${
              switchFailed ? "text-red-200" : "text-amber-200"
            }`}
          >
            {switchNote}
          </p>
        ) : null}
        <p className="px-1 font-sans text-xs leading-snug text-neutral-500">
          One TTS engine is loaded on the voice server&apos;s GPU at a time. Classic offers the
          built-in preset voices with accent and mood shaping; Custom speaks with voices cloned
          zero-shot from your reference clips; Trained speaks with voices fine-tuned from hundreds
          of your own samples. Each engine remembers its own voice selection, and any of them can
          be restored at any time.
        </p>
        {capabilities.usesNumSteps ? (
          <div className="grid gap-1.5 px-1 pt-1">
            <SliderControlPanel
              ariaLabel={`${engineLabel(engine)} engine diffusion steps`}
              ariaValueText={`${settings.dotsNumSteps} steps`}
              color={[190, 90, 100]}
              intensity={100}
              label="Streaming steps"
              max={VOICE_SETTINGS_RANGES.dotsNumSteps.max}
              min={VOICE_SETTINGS_RANGES.dotsNumSteps.min}
              step={VOICE_SETTINGS_RANGES.dotsNumSteps.step}
              value={settings.dotsNumSteps}
              valueText={`${settings.dotsNumSteps} steps`}
              onPreview={(dotsNumSteps) => {
                draggingRef.current.add("dotsNumSteps");
                markInteraction();
                setSettings((current) => ({ ...current, dotsNumSteps }));
              }}
              onCommit={(dotsNumSteps) => void commit("dotsNumSteps", dotsNumSteps)}
            />
            <p className="font-sans text-xs leading-snug text-neutral-500">
              How many diffusion steps the {engineLabel(engine)} engine runs per reply. Fewer steps
              reach the first audio sooner and use less GPU, at some quality cost; more steps are
              smoother but slower to start. Only affects engines with a diffusion sampler.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
