import type { VoiceEngineCapabilities } from "../voice-settings/types";

export type VoiceHostRefreshResult =
  | { ok: true; status: number }
  | { ok: false; error: string; status?: number };

// One entry of the server's engine registry manifest (nova_voice.tts_engines
// dashboard_engines_manifest()) — id/label plus what voice controls to render
// for it. The dashboard renders off this array (and its capabilities) instead
// of a hardcoded classic/custom pair, so a new engine the server advertises
// needs no dashboard code change to appear in the picker.
export type VoiceHostEngineDescriptor = {
  id: string;
  label: string;
  capabilities?: VoiceEngineCapabilities;
};

export type VoiceHostCatalog = {
  voices: { value: string; label: string; detail: string }[];
  languages: string[];
  accents: string[];
  emotions: string[];
  ranges: Record<string, { min: number; max: number; step: number; default: number }>;
  current?: unknown;
  /** Id of the resident TTS engine module, from the server's engine registry. */
  engine?: string;
  engines?: VoiceHostEngineDescriptor[];
  /** The resident engine's own voice catalogue (custom clones / trained checkpoints), if it has one. */
  engineVoices?: { id: string; name?: string; language?: string }[];
};

// GET /v1/engine: the resident engine plus the root-side switcher's progress
// file, which outlives orchestrator restarts so the dashboard can follow a
// switch across the downtime it intentionally causes.
export type VoiceHostEngineStatus = {
  engine: string;
  engines?: VoiceHostEngineDescriptor[];
  switch?: {
    target?: string;
    phase?: "preparing" | "restarting" | "warming" | "ready" | "failed";
    updatedAt?: string;
    error?: string;
  };
  tts?: { ok?: boolean; ready?: boolean; error?: string; speaker?: string };
};

export type VoiceHostPreviewResult =
  | { ok: true; audio: Buffer; contentType: string }
  | { ok: false; error: string; status?: number };

export type VoiceHostSatelliteStatus = {
  satelliteId: string;
  roomId?: string;
  connected?: boolean;
  connectedAt?: string;
  disconnectedAt?: string;
  lastEventAt?: string;
};

export type VoiceHostEngineVoice = {
  id: string;
  name?: string;
  language?: string;
  speakerScale?: number;
};

export type VoiceHostEngineVoiceBuildResult =
  | { ok: true; voice?: Record<string, unknown> }
  | { ok: false; error: string; status?: number };

export type VoiceHostRelayResult = {
  status: number;
  body: string;
  contentType: string;
};

export type VoiceHostJsonResult = { payload: unknown } | { error: string; status?: number };

/** One household mutation a dry-run turn planned but withheld. */
export type VoiceDryRunRequest = {
  method: string;
  path: string;
  body?: Record<string, unknown> | null;
};

export type VoiceUtteranceResult = {
  utterance_id?: string;
  executed?: boolean;
  dry_run?: boolean;
  dry_run_requests?: VoiceDryRunRequest[];
  response_text?: string | null;
  policy_reason?: string;
};

export type RouteArmTiming = {
  n: number;
  /// Null rather than zero when nothing has run. Zero reads as "instant",
  /// which is the opposite of "no data".
  p50: number | null;
  p95: number | null;
};

export type CompanionComparison = {
  workload: string;
  at: string;
  spoken: string;
  companion: { text: string | null; elapsedMs: number | null };
  local: { text: string | null; elapsedMs: number | null };
};

export type CompanionRouteSummary = {
  pass: string;
  mode: string;
  /// Latency for this pass, per place it ran. `fallbackOverhead` is what a
  /// failed companion attempt cost before the local run started.
  companionMs: RouteArmTiming;
  localMs: RouteArmTiming;
  fallbackOverheadMs: RouteArmTiming;
  /// Whether both arms are being run for this pass to compare them.
  comparing: boolean;
  /// The exact gate stopping this pass, in the voice server's own words.
  eligibility: string;
  offered: number;
  accepted: number;
  rejected: number;
  completed: number;
  failed: number;
  fellBack: number;
  paused: boolean;
};

export type CompanionPresence = {
  state: "home" | "away" | "unknown";
  source: string;
  ageSeconds: number | null;
  detail: string;
  /// Whether automation should act on this. `unknown` never is.
  actionable: boolean;
};

export type CompanionStatusSummary = {
  enabled: boolean;
  forceLocal: boolean;
  connected: boolean;
  identity: string | null;
  locality: string | null;
  tier: string | null;
  tierReason: string | null;
  appVersion: string | null;
  osVersion: string | null;
  workloads: string[];
  telemetryAgeSeconds: number | null;
  heartbeatAgeSeconds: number | null;
  activeAttempts: number;
  routes: CompanionRouteSummary[];
  /// Home, away, or unknown — and never inferred from the socket. Null only if
  /// an older voice server does not publish it.
  presence: CompanionPresence | null;
  /// Recent turns answered by both sides, newest last. Only populated while a
  /// pass is in comparison mode.
  comparisons: CompanionComparison[];
  /// True when the device is connected but has stopped reporting. Computed
  /// here rather than left to the card, because it is the one reading that is
  /// easy to misdiagnose: a suspended app *disconnects*, so a connected
  /// session with frozen telemetry is a client fault and never a sleeping
  /// phone.
  reportingStalled: boolean;
};

export type SpeakerTemplateSummary = {
  id: string;
  state: "provisional" | "pending" | "active";
  sampleCount: number;
  claimedName?: string | null;
  claimedPronouns?: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string | null;
};

export type SpeakerProfileSummary = {
  id: string;
  displayName: string;
  pronouns?: string | null;
  speechPreferences?: {
    language: string;
    speech_rate: number;
    delivery_mode: "auto" | "normal" | "whisper";
    accessibility_pacing: boolean;
    pronunciations: Record<string, string>;
  };
  createdAt: string;
  updatedAt: string;
  templates: SpeakerTemplateSummary[];
};

export type SpeakerProfilesPayload = {
  enabled?: boolean;
  profiles: SpeakerProfileSummary[];
  provisionalTemplates: SpeakerTemplateSummary[];
};

export type VoiceHostHealthProbe = {
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
  health?: unknown;
};

export type AgentAdministrationPayload = {
  goals: Array<Record<string, unknown> & { id: string; status: string; summary: string }>;
  plans: Array<Record<string, unknown> & { id: string; status: string; goal_id: string }>;
  executions: Array<Record<string, unknown> & { id: string; status: string }>;
  grants: Array<Record<string, unknown> & {
    id: string;
    grantee_id: string;
    capability: string;
    active: boolean;
    target_scope: string[];
    expires_at?: string | null;
  }>;
  identities: Array<Record<string, unknown> & {
    person_id: string;
    role: "owner" | "recognized_household" | "guest";
  }>;
  research: AgentResearch[];
  briefingSchedules: AgentBriefingSchedule[];
  briefings: AgentBriefing[];
  subscriptions: AgentEventSubscription[];
  audit: Array<Record<string, unknown> & {
    id: string;
    actor_id: string;
    action: string;
    object_type: string;
    object_id: string;
    created_at: string;
  }>;
  auditTotal: number;
};

export type AgentResearch = {
  id: string;
  owner_id: string;
  query: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  spoken_summary?: string | null;
  detail: Record<string, unknown>;
  citations: string[];
  uncertainty: "low" | "medium" | "high";
  backend?: string | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type AgentBriefingSchedule = {
  id: string; owner_id: string; period: "morning" | "evening";
  local_time: string; timezone: string; enabled: boolean; last_local_date?: string | null;
};

export type AgentBriefing = {
  id: string; owner_id: string; period: "morning" | "evening"; local_date: string;
  summary: string; agenda: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>; preparation_prompts: string[];
};

export type AgentEventSubscription = {
  id: string; owner_id: string; summary: string; event_kind: string;
  match: Record<string, unknown>; active: boolean; one_shot: boolean;
  trigger_count: number; triggered_at?: string | null;
};

export type AgentMemory = {
  id: string;
  text: string;
  memory_type: string;
  owner_id?: string | null;
  pinned: boolean;
  needs_confirmation: boolean;
  created_at: string;
  expires_at?: string | null;
};

export type AgentAutomation = {
  id: string;
  owner_id: string;
  summary: string;
  trigger: Record<string, unknown>;
  proposed_actions: Array<Record<string, unknown>>;
  simulation?: Record<string, unknown> | null;
  state: "draft" | "simulated" | "approved" | "active" | "paused" | "rolled_back" | "failed";
  monitor_failures: number;
};

export type ProactiveIntervention = {
  id: string;
  reason_code: string;
  reason_detail: string;
  channel: "voice" | "dashboard" | "notification";
  status: string;
  feedback?: "accepted" | "dismissed" | "redundant" | "annoying" | null;
  created_at: string;
};
