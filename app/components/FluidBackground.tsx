"use client";

// Animated WebGL dashboard background — facade
// (specs/agent-token-footprint.md §3.3). The body lives in
// avatar/fluid-background/:
//
//   types.ts            precision, debug and diagnostics shapes
//   shaders.ts          GLSL sources, precision directive, TARGET_DPR
//   gl-program.ts       shader compile/link, canvas sizing, texture upload
//   FluidBackground.tsx the component; owns the GL context and draw loop

export type {
  FluidBackgroundDebug,
  FluidBackgroundDiagnostics,
  FluidPrecision,
} from "./avatar/fluid-background/types";
export { FluidBackground } from "./avatar/fluid-background/FluidBackground";
