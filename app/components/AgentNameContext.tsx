"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { VOICE_SETTINGS_DEFAULTS } from "../../lib/voice-settings";
import { DEFAULT_TRANSCRIPT_TEMPLATE } from "../../lib/voice-transcript";

type AgentNameContextValue = {
  agentName: string;
  setAgentName: (name: string) => void;
  transcriptTemplate: string;
  setTranscriptTemplate: (template: string) => void;
};

const AgentNameContext = createContext<AgentNameContextValue>({
  agentName: VOICE_SETTINGS_DEFAULTS.agentName,
  setAgentName: () => undefined,
  transcriptTemplate: DEFAULT_TRANSCRIPT_TEMPLATE,
  setTranscriptTemplate: () => undefined,
});

export function AgentNameProvider({
  children,
  initialName,
}: {
  children: ReactNode;
  initialName: string;
}) {
  const [agentName, setAgentName] = useState(initialName);
  const [transcriptTemplate, setTranscriptTemplate] = useState(DEFAULT_TRANSCRIPT_TEMPLATE);
  useEffect(() => {
    document.title = `${agentName} Control`;
  }, [agentName]);

  // `/` is statically generated (app/page.tsx: dynamic = "force-static"), so
  // the server-seeded initialName above is whatever the build-time container
  // resolved — that container has no access to the live dashboard-preferences
  // volume, so it falls back to the config default rather than the real
  // shared config. Self-correct once against the live value on every route,
  // not just the config page (which already refreshes via VoiceConfig). The
  // transcript decoration template rides on the same voice payload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/voice", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await response.json() as {
          voice?: { agentName?: string; transcriptTemplate?: string };
        };
        const liveName = data.voice?.agentName;
        if (!cancelled && liveName) {
          setAgentName(liveName);
        }
        const liveTemplate = data.voice?.transcriptTemplate;
        if (!cancelled && liveTemplate) {
          setTranscriptTemplate(liveTemplate);
        }
      } catch (error) {
        console.error("[nova-dashboard] failed to load live agent name", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ agentName, setAgentName, transcriptTemplate, setTranscriptTemplate }),
    [agentName, transcriptTemplate],
  );
  return <AgentNameContext.Provider value={value}>{children}</AgentNameContext.Provider>;
}

export function useAgentName() {
  return useContext(AgentNameContext);
}
