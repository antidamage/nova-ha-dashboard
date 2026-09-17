"use client";

import type { CameraPreference } from "./types";

/** SOLE module-level state owner in this package: the camera preference cache. */
let cachedCameraPreferences: CameraPreference[] | null = null;

/** `dashboard.kiosk.cameras`, cached for the life of the page — same source
 * `FacePreview` reads for rotation, so selection and rotation never disagree
 * about which camera is which. */
export async function loadCameraPreferences(): Promise<CameraPreference[]> {
  if (cachedCameraPreferences) return cachedCameraPreferences;
  try {
    const response = await fetch("/api/config/client", { cache: "no-store" });
    if (!response.ok) return (cachedCameraPreferences = []);
    const body = (await response.json()) as { dashboard?: { kiosk?: { cameras?: CameraPreference[] } } };
    cachedCameraPreferences = body.dashboard?.kiosk?.cameras ?? [];
  } catch {
    cachedCameraPreferences = [];
  }
  return cachedCameraPreferences;
}
