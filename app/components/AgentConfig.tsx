"use client";

import { Bot, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_SETTINGS_RANGES,
  normalizeAgentSettings,
  type AgentSettings,
} from "../../lib/agent-settings";
import type { AgentPreferences } from "../../lib/types";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { useSettingCooldown } from "./useSettingCooldown";

type AgentSettingKey = Exclude<keyof AgentSettings, "updatedAt">;
type SyncResult = { ok: boolean; error?: string };

export function AgentConfig({ initialSettings }: { initialSettings?: AgentPreferences | null }) {
  const [settings, setSettings] = useState<AgentSettings>(
    () => normalizeAgentSettings(initialSettings),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const draggingRef = useRef(new Set<AgentSettingKey>());
  const requestVersionRef = useRef(0);
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (draggingRef.current.size || isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Agent settings request failed: ${response.status}`);
      }
      const data = await response.json() as { agent?: AgentPreferences };
      if (!draggingRef.current.size && !isCoolingDown()) {
        setSettings(normalizeAgentSettings(data.agent));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load agent settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(async <K extends AgentSettingKey>(
    key: K,
    value: AgentSettings[K],
  ) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    draggingRef.current.delete(key);
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("Saving Agent settings and notifying Iridium...");
    setMessageTone("ok");
    try {
      const response = await fetch("/api/agent", {
        body: JSON.stringify({ [key]: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        agent?: AgentPreferences;
        error?: string;
        iridium?: SyncResult;
      };
      if (!response.ok) {
        throw new Error(data.error || `Agent settings update failed: ${response.status}`);
      }
      if (requestVersion === requestVersionRef.current && data.agent && !draggingRef.current.size) {
        setSettings(normalizeAgentSettings(data.agent));
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.iridium?.ok) {
        setMessage("Agent settings saved and applied live on Iridium.");
        setMessageTone("ok");
      } else {
        setMessage(`Saved locally. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to update agent settings");
      setMessageTone("error");
    }
  }, [markInteraction]);

  const stageNumber = (key: AgentSettingKey, value: number) => {
    draggingRef.current.add(key);
    markInteraction();
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <ConfigAccordion
      id="agent"
      title="Agent"
      icon={<Bot className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Runtime controls for how the local agent completes and verifies work. These settings are
        global and are not saved with a voice or personality.
      </p>

      <button
        type="button"
        role="switch"
        aria-checked={settings.ralphLoopEnabled}
        className={`cyber-checkbox-row mb-4 w-full border p-4 text-left ${
          settings.ralphLoopEnabled ? "cyber-checkbox-row-active" : ""
        }`}
        onClick={() => void commit("ralphLoopEnabled", !settings.ralphLoopEnabled)}
      >
        <span
          className={`cyber-checkbox ${settings.ralphLoopEnabled ? "cyber-checkbox-checked" : ""}`}
          aria-hidden="true"
        >
          {settings.ralphLoopEnabled ? <Check className="h-5 w-5" strokeWidth={3.5} /> : null}
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="theme-display-label zone-title-bar">Ralph Wiggum loop</span>
          <span className="theme-display-detail">
            After one device command, keep checking authoritative state until it is verified or a
            bound below is reached. The command itself is never sent twice.
          </span>
        </span>
      </button>

      <div className={`grid gap-4 ${settings.ralphLoopEnabled ? "" : "opacity-50"}`}>
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
