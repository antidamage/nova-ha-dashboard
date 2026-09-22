"use client";

// Controls & Devices section — facade. Lazy-loaded by ConfigWorkspace.tsx through
// next/dynamic, so it re-exports only the component. The body lives in
// config/devices/ (specs/agent-token-footprint.md §3.3).
export { ControlsConfig } from "./config/devices/ControlsConfig";
