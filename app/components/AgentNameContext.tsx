"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { VOICE_SETTINGS_DEFAULTS } from "../../lib/voice-settings";

type AgentNameContextValue = {
  agentName: string;
  setAgentName: (name: string) => void;
};

const AgentNameContext = createContext<AgentNameContextValue>({
  agentName: VOICE_SETTINGS_DEFAULTS.agentName,
  setAgentName: () => undefined,
});

export function AgentNameProvider({
  children,
  initialName,
}: {
  children: ReactNode;
  initialName: string;
}) {
  const [agentName, setAgentName] = useState(initialName);
  useEffect(() => {
    document.title = `${agentName} Control`;
  }, [agentName]);
  const value = useMemo(() => ({ agentName, setAgentName }), [agentName]);
  return <AgentNameContext.Provider value={value}>{children}</AgentNameContext.Provider>;
}

export function useAgentName() {
  return useContext(AgentNameContext);
}
