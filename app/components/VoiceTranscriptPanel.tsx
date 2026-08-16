"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAX_VOICE_TRANSCRIPTS,
  VOICE_TRANSCRIPT_STATUS_SEPARATOR,
  formatVoiceTranscriptParts,
  type VoiceTranscriptEvent,
} from "../../lib/voice-transcript";
import { subscribeToDashboardEvents } from "./sharedDashboardEvents";
import { useAgentName } from "./AgentNameContext";

function mergeTranscripts(
  current: VoiceTranscriptEvent[],
  incoming: VoiceTranscriptEvent[],
): VoiceTranscriptEvent[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    if (entry && typeof entry.id === "string" && !byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-MAX_VOICE_TRANSCRIPTS);
}

export function VoiceTranscriptPanel() {
  const { agentName, transcriptTemplate } = useAgentName();
  const [transcripts, setTranscripts] = useState<VoiceTranscriptEvent[]>([]);
  const [open, setOpen] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  // Drives the working -> failed handover for a turn that never came back.
  // Only ticks while something is actually in flight (see below), so an idle
  // dashboard never re-renders on a timer.
  const [now, setNow] = useState(() => new Date());
  const bodyId = useId();
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToDashboardEvents({
      "voice-transcript": (event) => {
        try {
          const transcript = JSON.parse(event.data) as VoiceTranscriptEvent;
          setTranscripts((current) => mergeTranscripts(current, [transcript]));
        } catch {
          // Ignore a malformed event without breaking later transcript lines.
        }
      },
      // A longer rendering of an already-displayed near-duplicate: the voice
      // server upgrades the existing line in place rather than appending.
      "voice-transcript-replaced": (event) => {
        try {
          const replacement = JSON.parse(event.data) as VoiceTranscriptEvent;
          setTranscripts((current) =>
            current.map((entry) => (entry.id === replacement.id ? replacement : entry)),
          );
        } catch {
          // Ignore a malformed event without breaking later transcript lines.
        }
      },
      "voice-transcript-cleared": () => setTranscripts([]),
    });

    void (async () => {
      try {
        const response = await fetch("/api/voice/transcript", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await response.json() as { transcripts?: VoiceTranscriptEvent[] };
        if (Array.isArray(data.transcripts)) {
          setTranscripts((current) => mergeTranscripts(current, data.transcripts || []));
        }
      } catch (error) {
        console.error("[nova-dashboard] failed to load voice transcript", error);
      }
    })();

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [transcripts.length]);

  // Rendered newest-first; storage stays oldest-first so retention trimming
  // in mergeTranscripts keeps dropping the oldest entries.
  const lines = useMemo(
    () => transcripts
      .map((entry) => ({
        id: entry.id,
        ...formatVoiceTranscriptParts(entry, agentName, transcriptTemplate, now),
      }))
      .reverse(),
    [agentName, now, transcriptTemplate, transcripts],
  );

  const hasWorkingLine = lines.some((line) => line.status === "working");

  useEffect(() => {
    if (!hasWorkingLine) {
      return;
    }
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [hasWorkingLine]);

  const clearTranscript = async () => {
    setClearing(true);
    setClearError(null);
    try {
      const response = await fetch("/api/voice/transcript", { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Clear failed: ${response.status}`);
      }
      setTranscripts([]);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : "Failed to clear voice transcript");
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="voice-transcript-panel mt-5 overflow-hidden border border-cyan-300/30">
      <div className="flex items-center justify-between gap-2 p-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-xs font-black uppercase text-neutral-300"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
            aria-hidden="true"
          />
          <span>Live transcript</span>
          <span className="text-neutral-600">{transcripts.length}</span>
        </button>
        <button
          type="button"
          className="config-page-button px-2 py-1.5"
          disabled={clearing || transcripts.length === 0}
          onClick={() => void clearTranscript()}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {clearing ? "Clearing..." : "Clear"}
        </button>
      </div>

      {open ? (
        <div id={bodyId} className="grid gap-2 border-t border-cyan-300/20 p-3">
          <div className="voice-transcript-screen">
            <div
              ref={logRef}
              role="log"
              aria-live="polite"
              className="voice-transcript-log overflow-y-auto p-3 leading-relaxed"
            >
              {lines.length ? (
                lines.map((line) => (
                  <p
                    key={line.id}
                    className={`voice-transcript-line voice-transcript-line--${line.role} whitespace-pre-wrap break-words`}
                  >
                    <span
                      className={
                        `voice-transcript-meta voice-transcript-meta--${line.role}`
                        + (line.outcome ? ` voice-transcript-meta--${line.outcome}` : "")
                      }
                    >
                      {line.prefix}
                    </span>
                    {"\n"}
                    <span className={`voice-transcript-meta voice-transcript-meta--${line.role}`}>
                      {line.bodyPrefix}
                    </span>
                    {line.text}
                    {line.statusGlyph ? (
                      <span className={`voice-transcript-status voice-transcript-status--${line.status}`}>
                        {VOICE_TRANSCRIPT_STATUS_SEPARATOR}
                        {line.statusGlyph}
                      </span>
                    ) : null}
                    {/* One line per stack that ran something, at the same size
                        and colour as the words above: this is meant to be read
                        and compared, not skimmed past. Both lines present means
                        both stacks processed the turn. */}
                    {line.routeLines?.map((routeLine) => (
                      <span key={routeLine} className="voice-transcript-routes">
                        {"\n"}
                        {routeLine}
                      </span>
                    ))}
                  </p>
                ))
              ) : (
                <p className="text-neutral-600">Waiting for a voice turn from the voice host...</p>
              )}
            </div>
          </div>
          {clearError ? <p role="alert" className="text-xs font-semibold text-red-200">{clearError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
