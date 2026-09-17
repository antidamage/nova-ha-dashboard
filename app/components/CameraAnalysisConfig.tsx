"use client";

// Camera scene-analysis editor — facade. Mounted by CameraConfig, so it
// re-exports only the component. The body lives in config/camera/
// (specs/agent-token-footprint.md §3.3).
export { CameraAnalysisConfig } from "./config/camera/CameraAnalysisConfig";
