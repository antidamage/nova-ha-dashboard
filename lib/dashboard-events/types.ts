import type { HaDomain, SpectrumCursor, SunStatus, Task } from "../types";
import type { Viewer } from "../tasks/ownership";
import type { VoiceTranscriptEvent } from "../voice-transcript";

export type DashboardEventClient = {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  /** Who this connection is for; task events are filtered to it (specs/private-reminders.md section 4). */
  viewer?: Viewer;
};

export type DashboardEventStore = {
  adaptiveLightingTimer: ReturnType<typeof setInterval> | null;
  adaptiveLightingTicking: boolean;
  buildPollTimer: ReturnType<typeof setInterval> | null;
  clients: Set<DashboardEventClient>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  householdEventBackboneStarted: boolean;
  haStateChangeTimer: ReturnType<typeof setTimeout> | null;
  haStateChangeUnsubscribe: (() => void) | null;
  haStateChangeReconnectTimer: ReturnType<typeof setTimeout> | null;
  haStateChangeReconnectAttempts: number;
  haHealthStatus: "ok" | "degraded";
  icloudSyncTimer: ReturnType<typeof setInterval> | null;
  icloudSyncing: boolean;
  latestBuildId: string | null;
  latestJson: string | null;
  latestSignature: string | null;
  latestSun: SunStatus | null;
  latestTaskAudioJson: string | null;
  latestTasks: Task[];
  latestTasksJson: string | null;
  taskLegacyOwner: string;
  latestReminderIconsJson: string | null;
  lightPollHoldUntil: number;
  nextClientId: number;
  nextIcloudSyncAt: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollPending: boolean;
  polling: boolean;
  spectrumCursors: Record<string, SpectrumCursor>;
  taskClients: Set<DashboardEventClient>;
  taskAlertSessions: Record<string, string>;
  taskAlertTimer: ReturnType<typeof setInterval> | null;
  taskAlertTicking: boolean;
  voiceSpeaking: { json: string; turnId: string; receivedAt: number; expiresAt: number } | null;
  voiceTranscripts: VoiceTranscriptEvent[];
  weatherRefreshTimer: ReturnType<typeof setInterval> | null;
};

export type ZoneActionInput = {
  action: string;
  brightnessPct?: number;
  cursor?: SpectrumCursor;
  rgb?: [number, number, number];
  zoneId: string;
};

export type EntityActionInput = {
  data?: Record<string, unknown>;
  domain: HaDomain;
  entityId: string;
  service: string;
};

export type VoiceSpeakingEvent = {
  phase: "start" | "end";
  turnId: string;
  satelliteId?: string;
  roomId?: string;
  /** Consonant-onset offsets in ms from audible speech start (start phase). */
  timingsMs?: number[];
  estimatedDurationMs?: number;
  /** Estimated delay between this event and audio leaving the speaker. */
  audibleOffsetMs?: number;
  /** Actual synthesized audio duration (end phase). */
  playedDurationMs?: number;
  /** How long ago the start was received — nonzero only on mid-speech replay
   *  to a freshly connected client. */
  elapsedMs?: number;
};
