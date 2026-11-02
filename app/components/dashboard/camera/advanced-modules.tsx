"use client";

import type { ComponentType } from "react";
import { CameraEventReport } from "./CameraEventReport";
import { CameraSavedRanges } from "./CameraSavedRanges";

export type CameraAdvancedModuleProps = {
  cameraId: string;
  /** The DVR window's wall-clock span, NaN until the recording has reported it. */
  oldestMs: number;
  newestMs: number;
};

type CameraAdvancedModule = {
  id: string;
  /** A disabled module renders nothing and makes no requests. */
  enabled: boolean;
  Component: ComponentType<CameraAdvancedModuleProps>;
};

/**
 * What the camera shows below its Advanced line, in order.
 * Categorisation was retired on 2026-11-02 and its service stopped: specs/camera-saved-ranges.md.
 */
export const CAMERA_ADVANCED_MODULES: readonly CameraAdvancedModule[] = [
  { id: "categorisation", enabled: false, Component: CameraEventReport },
  { id: "saved-ranges", enabled: true, Component: CameraSavedRanges },
];

export function cameraAdvancedModuleEnabled(id: string): boolean {
  return CAMERA_ADVANCED_MODULES.some((entry) => entry.id === id && entry.enabled);
}
