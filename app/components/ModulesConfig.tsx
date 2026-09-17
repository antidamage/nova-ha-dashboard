"use client";

// Modules configuration tab — facade. Lazy-loaded by ConfigWorkspace.tsx
// through next/dynamic, so it re-exports only the component. The body lives
// in config/modules/ (specs/agent-token-footprint.md §3.3).
export { ModulesConfig } from "./config/modules/ModulesConfig";
