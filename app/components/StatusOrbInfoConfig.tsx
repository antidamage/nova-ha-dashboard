"use client";

// Status Orb Info section — facade. Lazy-loaded by ConfigWorkspace.tsx through
// next/dynamic, so it re-exports only the component. The body lives in
// config/orb-info/ (specs/agent-token-footprint.md §3.3).
export { StatusOrbInfoConfig } from "./config/orb-info/StatusOrbInfoConfig";
