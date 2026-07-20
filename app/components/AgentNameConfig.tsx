"use client";

import { UserRound, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AGENT_NAME_MAX_LENGTH } from "../../lib/voice-settings";
import { useAgentName } from "./AgentNameContext";

type SyncResult = { ok: boolean; error?: string };

// The agent's name is a first-class household setting: it brands the title
// bar, transcripts, and the voice persona everywhere. Two fields drive it:
//   - Agent display name: what you SEE (title bar, transcripts, config copy).
//     Emoji and symbols are allowed — this is pure branding.
//   - Agent name pronunciation: the plain, spoken name the voice service uses
//     for ASR biasing, the LLM persona, and TTS. Optional; empty means the
//     voice service falls back to the display name.
// Both are stored with the voice preferences and applied live on Iridium
// through the usual settings-refresh signal.
export function AgentNameConfig() {
  const { agentName, setAgentName } = useAgentName();
  const [draft, setDraft] = useState(agentName);
  const [pronunciation, setPronunciation] = useState("");
  const [pronunciationDraft, setPronunciationDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");

  useEffect(() => {
    setDraft(agentName);
  }, [agentName]);

  // Pull the live pronunciation once (the display name arrives via context).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/voice", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await response.json() as {
          voice?: { agentNamePronunciation?: string };
        };
        const live = data.voice?.agentNamePronunciation;
        if (!cancelled && typeof live === "string") {
          setPronunciation(live);
          setPronunciationDraft(live);
        }
      } catch {
        // Leave the field empty; a save still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const post = async (
    body: Record<string, string>,
    label: string,
  ): Promise<{ voice?: { agentName?: string; agentNamePronunciation?: string } } | null> => {
    setMessage(`Saving and notifying Iridium…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        iridium?: SyncResult;
        voice?: { agentName?: string; agentNamePronunciation?: string };
      };
      if (!response.ok) {
        throw new Error(data.error || `${label} update failed: ${response.status}`);
      }
      if (data.iridium?.ok) {
        setMessage(`${label} is saved and live on the voice service.`);
        setMessageTone("ok");
      } else {
        setMessage(`Saved. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
        setMessageTone("warning");
      }
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Failed to update the ${label.toLowerCase()}`);
      setMessageTone("error");
      return null;
    }
  };

  const commitDisplayName = async () => {
    const candidate = draft.trim();
    if (!candidate || candidate === agentName) {
      setDraft(agentName);
      return;
    }
    setAgentName(candidate);
    const data = await post({ agentName: candidate }, "Agent display name");
    if (data?.voice?.agentName) {
      setAgentName(data.voice.agentName);
      setDraft(data.voice.agentName);
    }
  };

  const commitPronunciation = async () => {
    const candidate = pronunciationDraft.trim();
    if (candidate === pronunciation) {
      setPronunciationDraft(pronunciation);
      return;
    }
    const data = await post({ agentNamePronunciation: candidate }, "Agent name pronunciation");
    if (data && typeof data.voice?.agentNamePronunciation === "string") {
      setPronunciation(data.voice.agentNamePronunciation);
      setPronunciationDraft(data.voice.agentNamePronunciation);
    }
  };

  return (
    <section className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 p-4 shadow-2xl">
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
          <span className="flex items-center gap-2">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Agent display name
          </span>
          <input
            className="cyber-text-input font-sans normal-case"
            maxLength={AGENT_NAME_MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commitDisplayName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="text-[0.7rem] font-normal normal-case leading-snug text-neutral-500">
            What you see — title bar, transcripts, branding. Emoji and symbols are fine.
          </span>
        </label>
        <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
          <span className="flex items-center gap-2">
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            Agent name pronunciation
          </span>
          <input
            className="cyber-text-input font-sans normal-case"
            maxLength={AGENT_NAME_MAX_LENGTH}
            placeholder={draft.trim() || "Nova"}
            value={pronunciationDraft}
            onChange={(event) => setPronunciationDraft(event.target.value)}
            onBlur={() => void commitPronunciation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
          <span className="text-[0.7rem] font-normal normal-case leading-snug text-neutral-500">
            How the voice says and hears the name. Plain text; leave blank to use the display name.
          </span>
        </label>
      </div>
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
