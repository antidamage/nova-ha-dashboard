"use client";

import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENT_NAME_MAX_LENGTH, AGENT_NAME_PATTERN } from "../../lib/voice-settings";
import { useAgentName } from "./AgentNameContext";

type SyncResult = { ok: boolean; error?: string };

// The agent's name is a first-class household setting: it brands the title
// bar, transcripts, and the voice persona everywhere. It is stored with the
// voice preferences (same key the Voice Agent section used to edit) and is
// applied live on Iridium through the usual settings-refresh signal.
export function AgentNameConfig() {
  const { agentName, setAgentName } = useAgentName();
  const [draft, setDraft] = useState(agentName);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");

  useEffect(() => {
    setDraft(agentName);
  }, [agentName]);

  const commit = async () => {
    const candidate = draft.trim();
    if (candidate === agentName) {
      setInvalid(false);
      return;
    }
    if (!AGENT_NAME_PATTERN.test(candidate)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAgentName(candidate);
    setMessage("Saving and notifying Iridium…");
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ agentName: candidate }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        iridium?: SyncResult;
        voice?: { agentName?: string };
      };
      if (!response.ok) {
        throw new Error(data.error || `Agent name update failed: ${response.status}`);
      }
      if (data.voice?.agentName) {
        setAgentName(data.voice.agentName);
      }
      if (data.iridium?.ok) {
        setMessage(`${candidate} is saved and live on the voice service.`);
        setMessageTone("ok");
      } else {
        setMessage(`Saved. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update the agent name");
      setMessageTone("error");
    }
  };

  return (
    <section className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
          <span className="flex items-center gap-2">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Agent Name
          </span>
          <input
            className="cyber-text-input font-sans normal-case"
            maxLength={AGENT_NAME_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <p className="text-xs leading-snug text-neutral-500">
          The household name for the whole agent — dashboard branding, transcripts, and the voice
          persona all follow it, live.
        </p>
      </div>
      {invalid ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-200">
          Use 1–{AGENT_NAME_MAX_LENGTH} letters, numbers, spaces, apostrophes, periods, or hyphens.
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`mt-2 text-sm font-semibold ${
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
    </section>
  );
}
