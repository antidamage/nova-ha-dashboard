"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceHostLlmDescriptor, VoiceHostLlmStatus } from "../../../../lib/voice-host-settings";

const POLL_MS = 3000;

const PHASE_NOTES: Record<string, (label: string) => string> = {
  preparing: (label) => `Preparing to load ${label}…`,
  starting: (label) => `Loading ${label}; the current model keeps answering…`,
  routing: (label) => `Moving the voice agent to ${label}…`,
  stopping: () => "Shutting down the previous model…",
};

type LlmStatusResponse = Partial<VoiceHostLlmStatus> & { reachable?: boolean };

// The language model picker's state: the voice server's model list, the routed
// model, and a switch followed by polling until it is ready or has failed.
// See specs/voice-llm-selector.md.
export function useVoiceLlmSwitch() {
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [llm, setLlm] = useState<string | null>(null);
  const [llms, setLlms] = useState<readonly VoiceHostLlmDescriptor[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The switcher's last status stamp before a request: a poll that still sees it
  // is reading the previous switch's outcome, not this one's.
  const lastStampRef = useRef<string | undefined>(undefined);
  const staleStampRef = useRef<string | undefined>(undefined);

  const label = useCallback(
    (id: string) => llms.find((entry) => entry.id === id)?.label ?? id,
    [llms],
  );

  const load = useCallback(async (): Promise<LlmStatusResponse | null> => {
    try {
      const response = await fetch("/api/voice/llm", { cache: "no-store" });
      const data = (await response.json()) as LlmStatusResponse;
      setReachable(data.reachable === true);
      if (data.reachable) {
        setLlm(data.llm ?? null);
        if (Array.isArray(data.llms)) setLlms(data.llms);
        lastStampRef.current = data.switch?.updatedAt;
      }
      return data;
    } catch {
      setReachable(false);
      return null;
    }
  }, []);

  useEffect(() => {
    void load().then((data) => {
      // Resume following a switch already in flight when the page loaded.
      const progress = data?.switch;
      if (progress && progress.phase !== "ready" && progress.phase !== "failed") setTarget(progress.target);
    });
  }, [load]);

  const requestSwitch = useCallback(async (next: string) => {
    setPending(null);
    setFailed(false);
    setNote("Asking the voice server to switch models…");
    staleStampRef.current = lastStampRef.current;
    try {
      const response = await fetch("/api/voice/llm", {
        body: JSON.stringify({ llm: next }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; changed?: boolean };
      if (!response.ok) {
        throw new Error(data.error || `Model switch failed: ${response.status}`);
      }
      if (data.changed === false) {
        setNote(null);
        return;
      }
      setTarget(next);
    } catch (error) {
      setFailed(true);
      setNote(error instanceof Error ? error.message : "Model switch request failed");
    }
  }, []);

  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(async () => {
      const data = await load();
      const progress = data?.switch;
      if (!data?.reachable || !progress || progress.target !== target) return;
      if (progress.updatedAt !== undefined && progress.updatedAt === staleStampRef.current) return;
      if (progress.phase === "failed") {
        setFailed(true);
        setNote(`Model switch failed: ${progress.error ?? "see the voice server logs"}`);
        setTarget(null);
      } else if (progress.phase === "ready" && data.llm === target) {
        setNote(`Switched to ${label(target)}.`);
        setTarget(null);
      } else {
        setNote((PHASE_NOTES[progress.phase] ?? PHASE_NOTES.starting)(label(target)));
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [target, load, label]);

  return {
    reachable,
    llm,
    llms,
    pending,
    setPending,
    switchInFlight: target !== null,
    requestSwitch,
    label,
    note,
    failed,
  };
}
