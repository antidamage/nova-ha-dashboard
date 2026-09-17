// Literal tables the Camera section reads: demo gating, the recorder's
// deviceState labels, the processing defaults and the scene-zone palette.
import type { Processing, SceneZone } from "./types";

export const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

// Map the recorder's classified deviceState to a short label + tone for the
// status readout, so a human can see WHEN and WHY the feed is (not) working.
export const STATE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  streaming: { label: "Streaming (live)", tone: "ok" },
  starting: { label: "Starting…", tone: "warn" },
  "demo-fallback": { label: "Test pattern (no device)", tone: "warn" },
  "device-absent": { label: "Device not detected", tone: "bad" },
  "device-busy": { label: "Device busy", tone: "bad" },
  "device-stalled": { label: "Device stalled (wedged)", tone: "bad" },
  "device-error": { label: "Encoder error", tone: "bad" },
  paused: { label: "Paused (re-initialising)", tone: "warn" },
  stopped: { label: "Stopped", tone: "bad" },
  unavailable: { label: "No encoder", tone: "bad" },
};

export const FALLBACK: Processing = { brightness: -0.12, contrast: 1.1, sharpness: 0.6 };

export const COLORS: Record<SceneZone["kind"], string> = { activity: "#54f5d0", vehicle: "#ffd56b", exclude: "#ff6b80" };
