"use client";

// Voice agent authority panel — facade. Lazy-loaded by ConfigWorkspace.tsx
// through next/dynamic, so it re-exports only the component. The body lives
// in config/agent/ (specs/agent-token-footprint.md §3.3).
export { AgentAdministration } from "./config/agent/AgentAdministration";
