"use client";

import { Bot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeAgentSettings,
  type AgentSettings,
} from "../../../../lib/agent-settings";
import type { AgentPreferences } from "../../../../lib/types";
import { ConfigAccordion } from "../../ConfigControls";
import { SwitchRow } from "../../SlideSwitch";
import { useSettingCooldown } from "../../useSettingCooldown";
import { RalphLoopControls } from "./RalphLoopControls";
import type { AgentSettingKey, SyncResult } from "./types";

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
    // No "saving"/"saved" banner: settings commit on every slider release, and a
    // status line appearing and disappearing under the controls shifts the page
    // out from under the gesture. Only problems are worth announcing.
    setMessage(null);
    try {
      const response = await fetch("/api/agent", {
        body: JSON.stringify({ [key]: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        agent?: AgentPreferences;
        error?: string;
        voiceHost?: SyncResult;
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
      if (!data.voiceHost?.ok) {
        setMessage(`Saved locally. ${data.voiceHost?.error ?? "The voice host did not confirm the refresh."}`);
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

      <div className="mb-4">
        <SwitchRow
          checked={settings.ralphLoopEnabled}
          label="Ralph Wiggum loop"
          detail="After one device command, keep checking authoritative state until it is verified or a bound below is reached. The command itself is never sent twice."
          onChange={(checked) => void commit("ralphLoopEnabled", checked)}
        />
      </div>

      <div className={`grid gap-4 ${settings.ralphLoopEnabled ? "" : "opacity-50"}`}>
        <RalphLoopControls commit={commit} settings={settings} stageNumber={stageNumber} />
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
