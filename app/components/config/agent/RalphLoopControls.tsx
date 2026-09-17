"use client";

import { AGENT_SETTINGS_RANGES, type AgentSettings } from "../../../../lib/agent-settings";
import { SliderControlPanel } from "../../ConfigControls";
import { SwitchRow } from "../../SlideSwitch";
import type { AgentSettingKey } from "./types";

// The Ralph loop bounds and the LLM confirmation controls under the loop switch.
export function RalphLoopControls({ commit, settings, stageNumber }: {
  commit: <K extends AgentSettingKey>(key: K, value: AgentSettings[K]) => Promise<void>;
  settings: AgentSettings;
  stageNumber: (key: AgentSettingKey, value: number) => void;
}) {
  return (
    <>
        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Ralph loop maximum state checks"
            ariaValueText={`${settings.ralphLoopMaxIterations} checks`}
            color={[80, 240, 160]}
            intensity={100}
            label="Maximum checks"
            max={AGENT_SETTINGS_RANGES.ralphLoopMaxIterations.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopMaxIterations.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopMaxIterations.step}
            value={settings.ralphLoopMaxIterations}
            valueText={`${settings.ralphLoopMaxIterations}`}
            onPreview={(value) => stageNumber("ralphLoopMaxIterations", value)}
            onCommit={(value) => void commit("ralphLoopMaxIterations", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Hard cap on refreshed state snapshots after the dashboard&apos;s immediate response.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Ralph loop pause"
            ariaValueText={`${settings.ralphLoopSleepMs} milliseconds`}
            color={[100, 180, 255]}
            intensity={100}
            label="Pause between checks"
            max={AGENT_SETTINGS_RANGES.ralphLoopSleepMs.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopSleepMs.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopSleepMs.step}
            value={settings.ralphLoopSleepMs}
            valueText={`${settings.ralphLoopSleepMs}ms`}
            onPreview={(value) => stageNumber("ralphLoopSleepMs", value)}
            onCommit={(value) => void commit("ralphLoopSleepMs", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Gives Home Assistant integrations time to publish their eventual state.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Ralph loop failure deadline"
            ariaValueText={`${settings.ralphLoopFailureSeconds} seconds`}
            color={[255, 140, 60]}
            intensity={100}
            label="Failure deadline"
            max={AGENT_SETTINGS_RANGES.ralphLoopFailureSeconds.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopFailureSeconds.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopFailureSeconds.step}
            value={settings.ralphLoopFailureSeconds}
            valueText={`${settings.ralphLoopFailureSeconds}s`}
            onPreview={(value) => stageNumber("ralphLoopFailureSeconds", value)}
            onCommit={(value) => void commit("ralphLoopFailureSeconds", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Wall-clock safety bound. The loop stops at whichever limit is reached first.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Thinking marker threshold"
            ariaValueText={`${settings.ralphLoopThinkingThresholdMs} milliseconds`}
            color={[190, 140, 255]}
            intensity={100}
            label="Thinking marker threshold"
            max={AGENT_SETTINGS_RANGES.ralphLoopThinkingThresholdMs.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopThinkingThresholdMs.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopThinkingThresholdMs.step}
            value={settings.ralphLoopThinkingThresholdMs}
            valueText={`${settings.ralphLoopThinkingThresholdMs}ms`}
            onPreview={(value) => stageNumber("ralphLoopThinkingThresholdMs", value)}
            onCommit={(value) => void commit("ralphLoopThinkingThresholdMs", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            A loop still polling past this long prints one non-verbal &quot;*Thinking*&quot;
            marker to the voice transcript, once per turn, never spoken aloud.
          </p>
        </div>

        <SwitchRow
          checked={settings.ralphLoopLlmVerifyEnabled}
          label="LLM confirmation"
          detail="When the quick state check has not yet succeeded, ask a small JSON-only model pass whether the observed state already satisfies the request (never spoken). Off falls back to the original state-only checks."
          onChange={(checked) => void commit("ralphLoopLlmVerifyEnabled", checked)}
        />

        <div
          className={`grid gap-1.5 ${settings.ralphLoopLlmVerifyEnabled ? "" : "opacity-50"}`}
        >
          <SliderControlPanel
            ariaLabel="LLM confirmation minimum interval"
            ariaValueText={`${settings.ralphLoopLlmVerifyMinIntervalMs} milliseconds`}
            color={[255, 110, 190]}
            intensity={100}
            label="LLM confirmation spacing"
            max={AGENT_SETTINGS_RANGES.ralphLoopLlmVerifyMinIntervalMs.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopLlmVerifyMinIntervalMs.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopLlmVerifyMinIntervalMs.step}
            value={settings.ralphLoopLlmVerifyMinIntervalMs}
            valueText={`${settings.ralphLoopLlmVerifyMinIntervalMs}ms`}
            onPreview={(value) => stageNumber("ralphLoopLlmVerifyMinIntervalMs", value)}
            onCommit={(value) => void commit("ralphLoopLlmVerifyMinIntervalMs", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Minimum spacing between LLM confirmation calls within one turn, however many
            devices are pending. Zero allows a call on every poll.
          </p>
        </div>

        <div
          className={`grid gap-1.5 ${settings.ralphLoopLlmVerifyEnabled ? "" : "opacity-50"}`}
        >
          <SliderControlPanel
            ariaLabel="LLM confirmation call timeout"
            ariaValueText={`${settings.ralphLoopLlmConfirmTimeoutSeconds} seconds`}
            color={[255, 90, 90]}
            intensity={100}
            label="LLM confirmation hard cutoff"
            max={AGENT_SETTINGS_RANGES.ralphLoopLlmConfirmTimeoutSeconds.max}
            min={AGENT_SETTINGS_RANGES.ralphLoopLlmConfirmTimeoutSeconds.min}
            step={AGENT_SETTINGS_RANGES.ralphLoopLlmConfirmTimeoutSeconds.step}
            value={settings.ralphLoopLlmConfirmTimeoutSeconds}
            valueText={`${settings.ralphLoopLlmConfirmTimeoutSeconds}s`}
            onPreview={(value) => stageNumber("ralphLoopLlmConfirmTimeoutSeconds", value)}
            onCommit={(value) => void commit("ralphLoopLlmConfirmTimeoutSeconds", value)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Maximum time a single LLM confirmation call may take. A slow or hung call is
            abandoned after this long so the loop can never run past its failure deadline by
            more than this bound.
          </p>
        </div>
    </>
  );
}
