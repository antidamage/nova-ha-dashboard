"use client";

// Updates section — facade. Lazy-loaded by ConfigWorkspace.tsx through
// next/dynamic, so it re-exports only the component. The body lives in
// config/updates/ (specs/agent-token-footprint.md §3.3).
export { UpdateConfig } from "./config/updates/UpdateConfig";
