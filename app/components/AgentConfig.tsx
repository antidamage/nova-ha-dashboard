"use client";

// Agent runtime settings section — facade. Lazy-loaded by ConfigWorkspace.tsx
// through next/dynamic, so it re-exports only the component. The body lives
// in config/agent/ (specs/agent-token-footprint.md §3.3).
export { AgentConfig } from "./config/agent/AgentConfig";
