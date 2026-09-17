"use client";

/*
 * Global system activity blocker — facade. The body lives in system/
 * (specs/agent-token-footprint.md §3.3).
 *
 *   system/types.ts                    blocker Mode
 *   system/constants.ts                health/update URLs, poll timings, copy
 *   system/SystemActivityBlocker.tsx   the poll loop, recovery reload, blocker
 */
export { SystemActivityBlocker } from "./system/SystemActivityBlocker";
