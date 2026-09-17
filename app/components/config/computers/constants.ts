// Platform and orientation choices offered by the managed-computer form.

import type {
  ManagedComputerOrientationValue,
  ManagedComputerPlatformValue,
} from "../../managed-computers-client";

export const PLATFORMS: Array<{ label: string; value: ManagedComputerPlatformValue }> = [
  { label: "Windows", value: "windows" },
  { label: "macOS", value: "macos" },
  { label: "KDE/Linux", value: "kde-linux" },
];

export const ORIENTATIONS: Array<{ label: string; value: ManagedComputerOrientationValue }> = [
  { label: "Landscape", value: "landscape" },
  { label: "Portrait", value: "portrait" },
];
