"use client";

// Theme and device configuration section — facade. Lazy-loaded by
// ConfigWorkspace.tsx through next/dynamic, so it re-exports only the
// component. The body lives in config/accent/ (specs/agent-token-footprint.md §3.3).
export { AccentConfig } from "./config/accent/AccentConfig";
