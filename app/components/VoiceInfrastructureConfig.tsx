"use client";

// Facade: the Voice Infrastructure config section lives in app/components/config/voice/.
// Re-exports only the component, so the lazy import keeps its path
// (specs/agent-token-footprint.md §3.3).
export { VoiceInfrastructureConfig } from "./config/voice/VoiceInfrastructureConfig";
