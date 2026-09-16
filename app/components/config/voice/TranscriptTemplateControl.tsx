"use client";

import { useEffect, useMemo, useState } from "react";
import { TRANSCRIPT_TEMPLATE_MAX_LENGTH } from "../../../../lib/voice-settings";
import { DEFAULT_TRANSCRIPT_TEMPLATE, formatVoiceTranscriptLine } from "../../../../lib/voice-transcript";

export function TranscriptTemplateControl({
  agentName,
  onCommit,
  value,
}: {
  agentName: string;
  onCommit: (value: string) => void;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    const candidate = draft.slice(0, TRANSCRIPT_TEMPLATE_MAX_LENGTH);
    if (candidate.trim() !== value.trim()) {
      onCommit(candidate);
    }
  };
  const preview = useMemo(() => {
    const template = draft.trim() ? draft : DEFAULT_TRANSCRIPT_TEMPLATE;
    const at = new Date().toISOString();
    const user = formatVoiceTranscriptLine(
      { id: "preview-user", at, role: "user", text: "Turn the lounge light on" },
      agentName,
      template,
    );
    const agent = formatVoiceTranscriptLine(
      { id: "preview-agent", at, role: "assistant", text: "Done.", agentName, kind: "command" },
      agentName,
      template,
    );
    return `${user}\n${agent}`;
  }, [agentName, draft]);
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
      <span>Transcript decoration</span>
      <input
        className="cyber-text-input font-mono normal-case"
        maxLength={TRANSCRIPT_TEMPLATE_MAX_LENGTH}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      <pre className="whitespace-pre-wrap break-words border border-cyan-300/20 bg-neutral-900/80 p-2 font-mono text-xs font-normal normal-case leading-relaxed text-cyan-100">
        {preview}
      </pre>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        Header decoration for live transcript lines. %u% is the user label (user lines only),
        %a% is the agent label (agent lines only), %d% the date, %t% the time, and %m% the turn
        mode (COMMAND or EXCHANGE). The ╰─ body lead-in is fixed. Clear the field to restore the
        stock decoration.
      </span>
    </label>
  );
}
