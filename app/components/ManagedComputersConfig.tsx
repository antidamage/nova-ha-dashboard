"use client";

// Managed Computers section — facade. Lazy-loaded by ConfigWorkspace.tsx
// through next/dynamic, so it re-exports only the component. The body lives in
// config/computers/ (specs/agent-token-footprint.md §3.3).
export { ManagedComputersConfig } from "./config/computers/ManagedComputersConfig";
