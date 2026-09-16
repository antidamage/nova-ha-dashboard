"use client";

// Facade: the Voice Agent config section lives in app/components/config/voice/.
// Re-exports only the component, so the lazy import keeps its path
// (specs/agent-token-footprint.md §3.3).
export { VoiceConfig } from "./config/voice/VoiceConfig";
