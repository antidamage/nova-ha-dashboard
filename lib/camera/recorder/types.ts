// Recorder state and status shapes. Types only.
import type { ChildProcess } from "child_process";
import type { CameraConfig, CameraSource } from "../config";

/**
 * Classified, human-answerable "why is (or isn't) the camera working" state.
 * Surfaced in the status API so the watchdog, the config UI and a human can all
 * tell WHEN and WHY the feed stopped, not just that it did.
 */
export type CameraDeviceState =
  | "streaming" // encoding the real device, fresh segments — all good
  | "starting" // encoder (re)launched, within warmup, no segment yet
  | "demo-fallback" // on the synthetic clock because the device isn't usable
  | "device-absent" // configured device path is missing (unplugged / not enumerated)
  | "device-busy" // device is held by another opener (EBUSY)
  | "device-stalled" // encoder alive on the device but segments stopped (hardware wedge)
  | "device-error" // encoder exited with an error we couldn't classify
  | "paused" // recorder intentionally paused (update / watchdog device surgery)
  | "stopped" // not recording and nothing scheduled
  | "unavailable"; // no ffmpeg binary on this host

export type RecorderState = {
  camera: CameraConfig;
  source: CameraSource;
  child: ChildProcess | null;
  startedAt: number;
  restarts: number;
  restartTimer: NodeJS.Timeout | null;
  sweepTimer: NodeJS.Timeout | null;
  superviseTimer: NodeJS.Timeout | null;
  stopped: boolean;
  lastError: string | null;
  // Classified state + counters for the status surface and self-heal.
  deviceState: CameraDeviceState;
  statusReason: string;
  lastHealthyAt: number | null;
  lastStallAt: number | null;
  consecutiveStalls: number;
  lastSelfHealAt: number;
  // Guards against overlapping stop/spawn (the source of the "device busy" race).
  transitioning: boolean;
};

export type RecorderRegistry = Map<string, RecorderState>;

export type RecorderStatus = {
  id: string;
  name: string;
  source: CameraSource;
  recording: boolean;
  ffmpegAvailable: boolean;
  deviceConnected: boolean;
  retentionSeconds: number;
  segmentSeconds: number;
  /** Wall-clock of the oldest still-available segment, if any. */
  oldestSegment: string | null;
  /** Wall-clock of the newest (live edge) segment, if any. */
  newestSegment: string | null;
  lastError: string | null;
  /** Classified "what state is the capture in" — see CameraDeviceState. */
  deviceState: CameraDeviceState;
  /** Human-readable "why" behind deviceState (surfaced in the config UI). */
  statusReason: string;
  /** True when the newest segment is fresh enough to call the feed live. */
  healthy: boolean;
  /** Age of the newest segment in seconds, or null if there are none. */
  newestSegmentAgeSeconds: number | null;
  /** How many consecutive stall-restarts the supervisor has done (0 = healthy). */
  consecutiveStalls: number;
  paused: boolean;
};
