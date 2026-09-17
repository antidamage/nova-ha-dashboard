"use client";

// Facade: the Phonoscope config section lives in app/components/config/phonoscope/.
// Lazy-loaded by ConfigWorkspace.tsx through next/dynamic, so it re-exports only
// the component (plus the type-only ModuleSetting it always re-exported, which
// erases at build time). See specs/agent-token-footprint.md §3.3.
export type { ModuleSetting } from "./config/phonoscope/types";
export { PhonoscopeConfig } from "./config/phonoscope/PhonoscopeConfig";
