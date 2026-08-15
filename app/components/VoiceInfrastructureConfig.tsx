"use client";

import {
  Check,
  Power,
  PowerOff,
  RadioTower,
  RefreshCw,
  Satellite,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CUSTOM_SPEAKER_PATTERN,
  VOICE_ENGINE_CAPABILITIES,
  VOICE_SETTINGS_RANGES,
  WEB_BACKENDS,
  normalizeVoiceSettings,
  type VoiceEngine,
  type VoiceEngineDescriptor,
  type VoiceSettings,
} from "../../lib/voice-settings";
import type { VoicePreferences } from "../../lib/types";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { VoiceServerStatus } from "./VoiceServerStatus";
import { useAgentName } from "./AgentNameContext";
import { useSettingCooldown } from "./useSettingCooldown";

type VoiceRoomOption = { id: string; name: string };

type SatelliteRow = {
  configuredRoomId: string;
  enabled: boolean;
  voiceEnabled: boolean;
  id: string;
  name: string;
  platform: string;
  status: {
    connected?: boolean;
    connectedAt?: string;
    disconnectedAt?: string;
    roomId?: string;
  } | null;
};

function satelliteStatusText(row: SatelliteRow, voiceHostOk: boolean) {
  if (!voiceHostOk) {
    return { text: "Status unavailable — device unreachable", tone: "warning" as const };
  }
  if (!row.status) {
    return { text: "Not seen since the voice server started", tone: "warning" as const };
  }
  const timestamp = row.status.connected ? row.status.connectedAt : row.status.disconnectedAt;
  const since = timestamp
    ? ` since ${new Date(timestamp).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    })}`
    : "";
  return row.status.connected
    ? { text: `Connected${since}`, tone: "ok" as const }
    : { text: `Disconnected${since}`, tone: "error" as const };
}

function SatellitePanel() {
  const [satellites, setSatellites] = useState<SatelliteRow[]>([]);
  const [rooms, setRooms] = useState<VoiceRoomOption[]>([]);
  const [voiceHostOk, setVoiceHostOk] = useState(true);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [savingRoom, setSavingRoom] = useState<string | null>(null);
  const [togglingVoice, setTogglingVoice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/satellites", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        voiceHost?: { ok?: boolean };
        rooms?: VoiceRoomOption[];
        satellites?: SatelliteRow[];
      };
      setSatellites(Array.isArray(data.satellites) ? data.satellites : []);
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
      setVoiceHostOk(data.voiceHost?.ok !== false);
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice satellites", error);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const reconnect = useCallback(async (row: SatelliteRow) => {
    setReconnecting(row.id);
    setMessage(`Restarting the satellite service on ${row.name}…`);
    try {
      const response = await fetch("/api/voice/satellites/reconnect", {
        body: JSON.stringify({ id: row.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Reconnect failed: ${response.status}`);
      }
      setMessage(`${row.name}: satellite service restarted — it reconnects on its own within seconds.`);
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "reconnect failed"}`);
    } finally {
      setReconnecting(null);
      // Give the relaunched process a moment to complete its handshake before
      // the status line refreshes.
      window.setTimeout(() => void load(), 4_000);
    }
  }, [load]);

  const setVoiceEnabled = useCallback(async (row: SatelliteRow, voiceEnabled: boolean) => {
    setTogglingVoice(row.id);
    setSatellites((current) =>
      current.map((item) => (item.id === row.id ? { ...item, voiceEnabled } : item)));
    setMessage(`${row.name}: turning satellite voice ${voiceEnabled ? "on" : "off"}…`);
    try {
      const response = await fetch("/api/voice/satellites", {
        body: JSON.stringify({ id: row.id, voiceEnabled }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Voice toggle failed: ${response.status}`);
      }
      setMessage(
        voiceEnabled
          ? `${row.name}: satellite voice on — it captures speech again.`
          : `${row.name}: satellite voice off — its microphone is ignored until turned back on.`,
      );
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "failed to toggle voice"}`);
      void load();
    } finally {
      setTogglingVoice(null);
      window.setTimeout(() => void load(), 2_000);
    }
  }, [load]);

  const setRoom = useCallback(async (row: SatelliteRow, roomId: string) => {
    setSavingRoom(row.id);
    setSatellites((current) =>
      current.map((item) => (item.id === row.id ? { ...item, configuredRoomId: roomId } : item)));
    const roomName = rooms.find((room) => room.id === roomId)?.name ?? "Unassigned";
    try {
      const response = await fetch("/api/voice/satellites", {
        body: JSON.stringify({ id: row.id, roomId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string; pushed?: boolean; pushError?: string };
      if (!response.ok) {
        throw new Error(data.error || `Room assignment failed: ${response.status}`);
      }
      if (!roomId) {
        setMessage(`${row.name}: grouped as unassigned on the dashboard.`);
      } else if (data.pushed) {
        setMessage(`${row.name}: moved to ${roomName} and synced to the satellite.`);
      } else {
        setMessage(`${row.name}: grouped as ${roomName} on the dashboard. ${data.pushError ?? ""}`.trim());
      }
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "failed to set room"}`);
    } finally {
      setSavingRoom(null);
      window.setTimeout(() => void load(), 3_000);
    }
  }, [load, rooms]);

  if (satellites.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-400">Satellites</p>
      {satellites.map((row) => {
        const status = satelliteStatusText(row, voiceHostOk);
        return (
          <div
            key={row.id}
            className="intensity-panel flex flex-wrap items-center justify-between gap-3 border border-cyan-300/30 bg-neutral-900/80 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Satellite className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black uppercase text-cyan-200">{row.name}</p>
                <p
                  className={`text-xs font-semibold ${
                    status.tone === "ok"
                      ? "text-cyan-200/80"
                      : status.tone === "warning"
                        ? "text-yellow-200"
                        : "text-red-200"
                  }`}
                >
                  {status.text}
                  {row.status?.roomId ? ` · ${row.status.roomId}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Room</span>
                <select
                  className="cyber-text-input"
                  value={row.configuredRoomId}
                  disabled={savingRoom !== null}
                  onChange={(event) => void setRoom(row, event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <MomentaryFeedbackButton
                type="button"
                role="switch"
                aria-checked={row.voiceEnabled}
                aria-label={`Turn satellite voice ${row.voiceEnabled ? "off" : "on"} for ${row.name}`}
                className={`config-page-button ${row.voiceEnabled ? "" : "opacity-70"}`}
                disabled={togglingVoice !== null}
                onClick={() => void setVoiceEnabled(row, !row.voiceEnabled)}
              >
                {row.voiceEnabled ? (
                  <Power className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PowerOff className="h-4 w-4" aria-hidden="true" />
                )}
                {row.voiceEnabled ? "Voice on" : "Voice off"}
              </MomentaryFeedbackButton>
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={reconnecting !== null || !row.enabled}
                onClick={() => void reconnect(row)}
              >
                <RefreshCw
                  className={`h-4 w-4 ${reconnecting === row.id ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Reconnect
              </MomentaryFeedbackButton>
            </div>
          </div>
        );
      })}
      {message ? <p role="status" className="text-xs font-semibold text-neutral-300">{message}</p> : null}
      <p className="font-sans text-xs leading-snug text-neutral-500">
        Room options come from Home Assistant&apos;s areas — the same ones the lighting sub-zones use.
        Choosing one saves the grouping here and syncs it to the satellite itself over SSH, restarting
        its service so it re-announces in the new room. Reconnect restarts the satellite service on that
        computer over SSH — the same recovery used when a satellite drops off or wedges. It relaunches
        and reconnects to the voice server by itself. Voice on/off is a per-satellite killswitch: turning
        it off makes the voice server ignore that satellite&apos;s microphone (so you can test other
        devices) while the satellite stays running and connected — no SSH, instant, and reversible.
      </p>
    </div>
  );
}

type EngineVoiceRow = {
  id: string;
  name?: string;
  language?: string;
  speakerScale?: number;
};

// Engine-scoped voice catalogue: list the resident engine's registered
// voices, delete them, and upload new ones. What "upload" means depends on
// the engine's capabilities (from the server's engine registry, not a
// hardcoded id check): Custom (dots.tts) builds a reference.wav from raw
// sample clips server-side (CPU ffmpeg, no GPU training); Trained
// (GPT-SoVITS) stores an already fine-tuned checkpoint bundle produced by the
// voice-training scripts. Classic has no catalogue at all -- capabilities say
// so and the panel shows a short note instead of empty controls.
function EngineVoicesPanel() {
  const [engineId, setEngineId] = useState<string | null>(null);
  const [engines, setEngines] = useState<VoiceEngineDescriptor[]>([]);
  const [voices, setVoices] = useState<EngineVoiceRow[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [speakerScale, setSpeakerScale] = useState(1.5);
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadEngine = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/engine", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        engine?: string;
        engines?: VoiceEngineDescriptor[];
      };
      setEngineId(typeof data.engine === "string" && data.engine ? data.engine : null);
      setEngines(Array.isArray(data.engines) ? data.engines : []);
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice engine status", error);
    }
  }, []);

  const activeEngine = engines.find((entry) => entry.id === engineId) ?? null;
  const capabilities = activeEngine?.capabilities
    ?? (engineId && engineId in VOICE_ENGINE_CAPABILITIES
      ? VOICE_ENGINE_CAPABILITIES[engineId as VoiceEngine]
      : null);
  const catalogueKind = capabilities?.voiceCatalogue ?? "none";
  const activeLabel = activeEngine?.label ?? engineId ?? "voice engine";

  const loadVoices = useCallback(async () => {
    if (!engineId || catalogueKind === "none") {
      setVoices([]);
      return;
    }
    try {
      const response = await fetch(`/api/voice/voices/${encodeURIComponent(engineId)}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as { voices?: EngineVoiceRow[] };
      setVoices(Array.isArray(data.voices) ? data.voices : []);
    } catch (error) {
      console.error(`[nova-dashboard] failed to load ${engineId} voices`, error);
    }
  }, [engineId, catalogueKind]);

  useEffect(() => {
    void loadEngine();
    const timer = window.setInterval(() => void loadEngine(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadEngine]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  // The upload id names a new catalogue entry regardless of engine -- same
  // slug shape the server's voice registries normalize to either way.
  const idValid = CUSTOM_SPEAKER_PATTERN.test(id);

  const upload = useCallback(async () => {
    if (!engineId || catalogueKind === "none") {
      return;
    }
    if (!idValid) {
      setMessage("Voice id must be lowercase letters, digits, - or _ (1-64 chars).");
      setMessageTone("error");
      return;
    }
    if (files.length === 0) {
      setMessage(catalogueKind === "bundle" ? "Choose the trained voice bundle files." : "Choose at least one sample clip.");
      setMessageTone("error");
      return;
    }
    setUploading(true);
    setMessage(
      catalogueKind === "bundle"
        ? `Uploading "${name || id}"…`
        : `Building "${name || id}" from ${files.length} clip${files.length === 1 ? "" : "s"}…`,
    );
    setMessageTone("ok");
    try {
      const formData = new FormData();
      formData.set("id", id);
      formData.set("name", name.trim() || id);
      formData.set("language", language.trim() || "en");
      if (catalogueKind === "clips") {
        formData.set("speaker_scale", String(speakerScale));
      }
      for (const file of files) {
        formData.append("files", file);
      }
      const response = await fetch(`/api/voice/voices/${encodeURIComponent(engineId)}`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json() as { error?: string; voice?: { reference_seconds?: number } };
      if (!response.ok) {
        throw new Error(data.error || `Upload failed: ${response.status}`);
      }
      const seconds = data.voice?.reference_seconds;
      setMessage(`"${name || id}" is ready${seconds ? ` — ${seconds}s reference built` : ""}.`);
      setMessageTone("ok");
      setFiles([]);
      setFileInputKey((key) => key + 1);
      void loadVoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload voice");
      setMessageTone("error");
    } finally {
      setUploading(false);
    }
  }, [engineId, catalogueKind, id, idValid, files, name, language, speakerScale, loadVoices]);

  const remove = useCallback(async (voiceId: string) => {
    if (!engineId) {
      return;
    }
    setDeleting(voiceId);
    setMessage(`Deleting "${voiceId}"…`);
    setMessageTone("ok");
    try {
      const response = await fetch(
        `/api/voice/voices/${encodeURIComponent(engineId)}/${encodeURIComponent(voiceId)}`,
        { method: "DELETE" },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Delete failed: ${response.status}`);
      }
      setMessage(`"${voiceId}" deleted.`);
      setMessageTone("warning");
      void loadVoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete voice");
      setMessageTone("error");
    } finally {
      setDeleting(null);
    }
  }, [engineId, loadVoices]);

  if (engineId === null) {
    return null;
  }

  return (
    <div className="mb-4 grid gap-3">
      <p className="text-xs font-black uppercase text-neutral-400">{activeLabel} voices</p>

      {catalogueKind === "none" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          The {activeLabel} engine has no voice catalogue to manage here — switch to Custom or
          Trained voices above to build or upload one.
        </p>
      ) : (
        <>
          {voices.length > 0 ? (
            <div className="grid gap-2">
              {voices.map((voice) => (
                <div
                  key={voice.id}
                  className="intensity-panel flex flex-wrap items-center justify-between gap-3 border border-cyan-300/30 bg-neutral-900/80 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase text-cyan-200">
                      {voice.name || voice.id}
                    </p>
                    <p className="text-xs font-semibold text-cyan-200/80">
                      {voice.id} · {voice.language || "en"}
                      {typeof voice.speakerScale === "number" ? ` · scale ${voice.speakerScale}` : ""}
                    </p>
                  </div>
                  <MomentaryFeedbackButton
                    type="button"
                    className="config-page-button"
                    disabled={deleting !== null}
                    onClick={() => void remove(voice.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </MomentaryFeedbackButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-sans text-xs leading-snug text-neutral-500">
              No {activeLabel.toLowerCase()} registered yet.
            </p>
          )}

          <div className="intensity-panel grid gap-2 border border-cyan-300/30 bg-neutral-900/80 p-3">
            <p className="text-xs font-black uppercase text-neutral-400">
              {catalogueKind === "bundle" ? "Upload a trained voice" : "Build a voice"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Voice id</span>
                <input
                  className="cyber-text-input"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  placeholder="johnny"
                />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Display name</span>
                <input
                  className="cyber-text-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Johnny Silverhand"
                />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Language</span>
                <input
                  className="cyber-text-input"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  placeholder="en"
                />
              </label>
              {catalogueKind === "clips" ? (
                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  <span>Speaker scale</span>
                  <input
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.1}
                    className="cyber-text-input"
                    value={speakerScale}
                    onChange={(event) => setSpeakerScale(Number(event.target.value) || 1.5)}
                  />
                </label>
              ) : null}
            </div>
            <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
              <span>{catalogueKind === "bundle" ? "Voice bundle files" : "Sample clips"}</span>
              <input
                key={fileInputKey}
                type="file"
                accept={catalogueKind === "clips" ? "audio/*" : undefined}
                multiple
                className="cyber-text-input"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            {id && !idValid ? (
              <p className="text-xs font-semibold text-red-200">
                Voice id must be lowercase letters, digits, - or _ (1-64 chars).
              </p>
            ) : null}
            <MomentaryFeedbackButton
              type="button"
              className="config-page-button"
              disabled={uploading || !idValid || files.length === 0}
              onClick={() => void upload()}
            >
              <UploadCloud className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} aria-hidden="true" />
              {uploading ? "Uploading…" : catalogueKind === "bundle" ? "Upload voice" : "Build & upload"}
            </MomentaryFeedbackButton>
          </div>
        </>
      )}

      {message ? (
        <p
          role="status"
          className={`text-xs font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
      {catalogueKind === "clips" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          Upload one or more clean sample clips (or a reference.wav already prepared with the
          voice-training scripts) under a lowercase id. The server trims silence, concatenates, and
          loudness-normalizes them into one reference clip dots.tts clones from -- no GPU training
          involved. Deleting a voice removes it immediately and cannot be undone.
        </p>
      ) : catalogueKind === "bundle" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          Upload the checkpoint bundle produced by the voice-training scripts (train on a GPU
          machine first) under a lowercase id. The server stores it as-is -- no training happens
          here. Deleting a voice removes it immediately and cannot be undone.
        </p>
      ) : null}
    </div>
  );
}

type SyncResult = { ok: boolean; error?: string };
type PipelineKey =
  | "conversationIdleSeconds"
  | "conversationMaxSeconds"
  | "ttsPrerollMs"
  | "ttsFrameMs"
  | "webAnswerMaxSentences"
  | "speakerMatchThreshold"
  | "speakerMatchMargin"
  | "speakerClusterThreshold"
  | "speakerConversationMatchThreshold";
type PipelineSettingKey =
  | PipelineKey
  | "satelliteNoiseGateEnabled"
  | "speakerRecognitionEnabled"
  | "voiceTrainingEnabled"
  | "webAccessEnabled"
  | "webBackend";

// Switches and selects, not sliders: they have no drag to forget.
const PIPELINE_NON_SLIDER_KEYS = [
  "satelliteNoiseGateEnabled",
  "speakerRecognitionEnabled",
  "voiceTrainingEnabled",
  "webAccessEnabled",
  "webBackend",
] as const;

function isPipelineSliderKey(key: PipelineSettingKey): key is PipelineKey {
  return !(PIPELINE_NON_SLIDER_KEYS as readonly string[]).includes(key);
}

type SpeakerMatchKey =
  | "speakerMatchThreshold"
  | "speakerMatchMargin"
  | "speakerClusterThreshold"
  | "speakerConversationMatchThreshold";

// The four speaker-matching sliders, rendered from one list so their notes,
// default markers, and snap targets stay in lock-step with lib/voice-settings.
// Order runs from the knob that most directly fixes "a new profile every time"
// (cluster) down to the fine within-conversation tolerance.
const SPEAKER_MATCH_SLIDERS: {
  key: SpeakerMatchKey;
  label: string;
  color: [number, number, number];
  note: string;
}[] = [
  {
    key: "speakerClusterThreshold",
    label: "New-profile threshold",
    color: [130, 200, 255],
    note:
      "How similar a new capture must be to fold into one of your existing unnamed voice "
      + "profiles instead of starting another. Lower this first if the system keeps making a "
      + "fresh profile for you across different mics and distances.",
  },
  {
    key: "speakerMatchThreshold",
    label: "Recognition threshold",
    color: [120, 230, 180],
    note:
      "How close a voice must be to count as an already-known person. Lower recognizes you more "
      + "readily from farther away or off-axis; set too low it can start confusing similar voices.",
  },
  {
    key: "speakerMatchMargin",
    label: "Decision margin",
    color: [255, 200, 90],
    note:
      "How far the best-matching person must lead the runner-up before a match is trusted. Lower "
      + "still decides when two people score alike; raise it if household members get mixed up.",
  },
  {
    key: "speakerConversationMatchThreshold",
    label: "Conversation hold",
    color: [200, 160, 255],
    note:
      "How much a voice can drift and still be treated as the same speaker within one open "
      + "conversation. Deliberately loose; lower tolerates more movement mid-exchange.",
  },
];

// System-wide voice killswitch. A single master on/off for the whole household:
// when off, voice host drops every microphone frame and closes the open
// conversation, so voice is fully disabled everywhere until it is turned back
// on. This is the shared, host-backed setting (POSTed to /api/voice, then pulled
// by VoiceHost) — distinct from the per-device browser voice-input toggle.
function VoiceKillswitch({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const { agentName } = useAgentName();
  const [enabled, setEnabled] = useState<boolean>(
    () => normalizeVoiceSettings(initialSettings).systemVoiceEnabled,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const requestVersionRef = useRef(0);

  const load = useCallback(async () => {
    // Never clobber an in-flight toggle with a stale poll.
    if (saving) {
      return;
    }
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as { voice?: VoicePreferences };
      if (!saving) {
        setEnabled(normalizeVoiceSettings(data.voice).systemVoiceEnabled);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice killswitch state", error);
    }
  }, [saving]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const toggle = useCallback(async () => {
    if (saving) {
      return;
    }
    const next = !enabled;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setSaving(true);
    setEnabled(next);
    setMessage(
      next
        ? "Turning voice on and notifying the voice host…"
        : "Turning voice off and closing the current conversation…",
    );
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ systemVoiceEnabled: next }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        voiceHost?: SyncResult;
        voice?: VoicePreferences;
      };
      if (!response.ok) {
        throw new Error(data.error || `Voice killswitch update failed: ${response.status}`);
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.voice) {
        setEnabled(normalizeVoiceSettings(data.voice).systemVoiceEnabled);
      }
      if (data.voiceHost?.ok) {
        setMessage(
          next
            ? "Voice is ON — the whole system is listening again."
            : "Voice is OFF — every microphone is ignored system-wide and the conversation was closed.",
        );
        setMessageTone(next ? "ok" : "warning");
      } else {
        setMessage(`Saved on ${agentName}. ${data.voiceHost?.error ?? "The voice host did not confirm the change."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion === requestVersionRef.current) {
        // Revert the optimistic flip so the control matches reality.
        setEnabled(!next);
        setMessage(error instanceof Error ? error.message : "Failed to update the voice killswitch");
        setMessageTone("error");
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setSaving(false);
      }
    }
  }, [agentName, enabled, saving]);

  return (
    <div className="mb-4 grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-400">System voice</p>
      <MomentaryFeedbackButton
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving}
        className={`cyber-checkbox-row border p-4 text-left ${
          enabled ? "cyber-checkbox-row-active" : ""
        } ${saving ? "opacity-70" : ""}`}
        onClick={() => void toggle()}
      >
        <span
          className={`cyber-checkbox ${enabled ? "cyber-checkbox-checked" : ""}`}
          aria-hidden="true"
        >
          {enabled
            ? <Power className="h-6 w-6" strokeWidth={3} />
            : <PowerOff className="h-6 w-6" strokeWidth={3} />}
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="theme-display-label zone-title-bar">
            {enabled ? "Voice enabled" : "Voice OFF"}
          </span>
          <span className="theme-display-detail">
            {enabled
              ? "Master switch for the whole system. Turn off to disable voice everywhere and close the current conversation."
              : "Voice is disabled for the entire system — no microphone is processed anywhere. Turn on to resume."}
          </span>
        </span>
      </MomentaryFeedbackButton>
      {message ? (
        <p
          role="status"
          className={`text-sm font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

// Global voice-pipeline tuning: the conversation window plus the satellite audio
// playback shaping (preroll and frame size). These are infrastructure knobs, not
// personality — they sit at the bottom of Voice Infrastructure rather than in the
// Voice Agent card. Each change POSTs the single field to /api/voice (which then
// notifies VoiceHost), exactly like the Voice Agent controls; the two sections edit
// disjoint fields so their independent polls never fight.
function VoicePipelineSettings({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const { agentName } = useAgentName();
  const [settings, setSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialSettings));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const draggingRef = useRef(new Set<PipelineKey>());
  const requestVersionRef = useRef(0);
  // Same rubber-band guard as the Voice Agent card: hold off the poll while a
  // slider is in use and for a few seconds after release.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const load = useCallback(async () => {
    if (draggingRef.current.size > 0 || isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Voice settings request failed: ${response.status}`);
      }
      const data = await response.json() as { voice?: VoicePreferences };
      if (draggingRef.current.size === 0 && !isCoolingDown()) {
        setSettings(normalizeVoiceSettings(data.voice));
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice pipeline settings", error);
    }
  }, [isCoolingDown]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(async (key: PipelineSettingKey, value: number | boolean | string) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    if (isPipelineSliderKey(key)) {
      draggingRef.current.delete(key);
    }
    setSettings((current) => ({ ...current, [key]: value }));
    // No "saving"/"saved" banner: settings commit on every slider release, and a
    // status line appearing and disappearing under the controls shifts the page
    // out from under the gesture. Only problems are worth announcing.
    setMessage(null);
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ [key]: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        voiceHost?: SyncResult;
        voice?: VoicePreferences;
      };
      if (!response.ok) {
        throw new Error(data.error || `Voice settings update failed: ${response.status}`);
      }
      if (requestVersion === requestVersionRef.current && data.voice && draggingRef.current.size === 0) {
        setSettings(normalizeVoiceSettings(data.voice));
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (!data.voiceHost?.ok) {
        setMessage(`Saved on ${agentName}. ${data.voiceHost?.error ?? "The voice host did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to update voice settings");
      setMessageTone("error");
    }
  }, [agentName, markInteraction]);

  return (
    <div className="grid gap-4">
      <p className="text-xs font-black uppercase text-neutral-400">Capture, Conversation &amp; Playback</p>

      <div className="grid gap-1.5">
        <MomentaryFeedbackButton
          type="button"
          role="switch"
          aria-checked={settings.speakerRecognitionEnabled}
          className={`cyber-checkbox-row border p-4 text-left ${
            settings.speakerRecognitionEnabled ? "cyber-checkbox-row-active" : ""
          }`}
          onClick={() => void commit(
            "speakerRecognitionEnabled",
            !settings.speakerRecognitionEnabled,
          )}
        >
          <span
            className={`cyber-checkbox ${
              settings.speakerRecognitionEnabled ? "cyber-checkbox-checked" : ""
            }`}
            aria-hidden="true"
          >
            {settings.speakerRecognitionEnabled
              ? <Check className="h-6 w-6" strokeWidth={3} />
              : null}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="theme-display-label zone-title-bar">Speaker personalization</span>
            <span className="theme-display-detail">
              {settings.speakerRecognitionEnabled
                ? "On: learn local voice templates from addressed turns and personalize recognized speakers"
                : "Off: do not extract, learn, or match household voice templates"}
            </span>
          </span>
        </MomentaryFeedbackButton>
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Enrollment is local and transparent. Nova stores voice embeddings, never enrollment audio;
          unnamed templates expire after 30 days.
        </p>
      </div>

      <div className="grid gap-1.5">
        <MomentaryFeedbackButton
          type="button"
          role="switch"
          aria-checked={settings.voiceTrainingEnabled}
          className={`cyber-checkbox-row border p-4 text-left ${
            settings.voiceTrainingEnabled ? "cyber-checkbox-row-active" : ""
          }`}
          onClick={() => void commit("voiceTrainingEnabled", !settings.voiceTrainingEnabled)}
        >
          <span
            className={`cyber-checkbox ${
              settings.voiceTrainingEnabled ? "cyber-checkbox-checked" : ""
            }`}
            aria-hidden="true"
          >
            {settings.voiceTrainingEnabled
              ? <Check className="h-6 w-6" strokeWidth={3} />
              : null}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="theme-display-label zone-title-bar">Voice training</span>
            <span className="theme-display-detail">
              {settings.voiceTrainingEnabled
                ? "On: unknown voices may wake and command, and every turn refines recognition"
                : "Off: only recognized household voices are heard"}
            </span>
          </span>
        </MomentaryFeedbackButton>
      </div>

      <div className="grid gap-1.5">
        <MomentaryFeedbackButton
          type="button"
          role="switch"
          aria-checked={settings.satelliteNoiseGateEnabled}
          className={`cyber-checkbox-row border p-4 text-left ${
            settings.satelliteNoiseGateEnabled ? "cyber-checkbox-row-active" : ""
          }`}
          onClick={() => void commit(
            "satelliteNoiseGateEnabled",
            !settings.satelliteNoiseGateEnabled,
          )}
        >
          <span
            className={`cyber-checkbox ${
              settings.satelliteNoiseGateEnabled ? "cyber-checkbox-checked" : ""
            }`}
            aria-hidden="true"
          >
            {settings.satelliteNoiseGateEnabled
              ? <Check className="h-6 w-6" strokeWidth={3} />
              : null}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="theme-display-label zone-title-bar">Satellite noise gate</span>
            <span className="theme-display-detail">
              {settings.satelliteNoiseGateEnabled
                ? "On: satellites send probable speech with protected pre-roll and silence tail"
                : "Off for testing: satellites transmit every captured 20 ms audio frame"}
            </span>
          </span>
        </MomentaryFeedbackButton>
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Runs locally on each native satellite before network transmission. Turn it off to bypass
          the noise/activity step completely while comparing capture and transcription behavior.
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="mt-2 text-xs font-black uppercase text-neutral-400">Web access</p>
        <MomentaryFeedbackButton
          type="button"
          role="switch"
          aria-checked={settings.webAccessEnabled}
          className={`cyber-checkbox-row border p-4 text-left ${
            settings.webAccessEnabled ? "cyber-checkbox-row-active" : ""
          }`}
          onClick={() => void commit("webAccessEnabled", !settings.webAccessEnabled)}
        >
          <span
            className={`cyber-checkbox ${
              settings.webAccessEnabled ? "cyber-checkbox-checked" : ""
            }`}
            aria-hidden="true"
          >
            {settings.webAccessEnabled ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
          </span>
          <span className="grid min-w-0 gap-1">
            <span className="theme-display-label zone-title-bar">Look things up online</span>
            <span className="theme-display-detail">
              {settings.webAccessEnabled
                ? `On: when a request needs current or external facts, ${agentName} rewrites it into a query and answers from the web`
                : `Off: ${agentName} answers only from on-device knowledge and household state`}
            </span>
          </span>
        </MomentaryFeedbackButton>
        <p className="px-1 text-xs leading-snug text-neutral-500">
          The only feature that sends anything off your local network: just the rewritten search
          query (never audio, {agentName}&apos;s personality, or household state), and only on a
          wake-word or follow-up turn. The web API key lives on the voice server, never in the
          dashboard.
        </p>
      </div>

      {settings.webAccessEnabled ? (
        <>
          {WEB_BACKENDS.length > 1 ? (
            <div className="grid gap-1.5">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Answer source
              </p>
              <div role="radiogroup" aria-label="Web answer source" className="grid gap-1.5">
                {WEB_BACKENDS.map((option) => {
                  const active = settings.webBackend === option.value;
                  return (
                    <MomentaryFeedbackButton
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`cyber-checkbox-row border p-4 text-left ${
                        active ? "cyber-checkbox-row-active" : ""
                      }`}
                      onClick={() => void commit("webBackend", option.value)}
                    >
                      <span
                        className={`cyber-checkbox ${active ? "cyber-checkbox-checked" : ""}`}
                        aria-hidden="true"
                      >
                        {active ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
                      </span>
                      <span className="grid min-w-0 gap-1">
                        <span className="theme-display-label zone-title-bar">{option.label}</span>
                        <span className="theme-display-detail">{option.detail}</span>
                      </span>
                    </MomentaryFeedbackButton>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <SliderControlPanel
              ariaLabel="Web answer length"
              ariaValueText={`${settings.webAnswerMaxSentences} sentences`}
              color={[120, 180, 255]}
              intensity={100}
              label="Web answer length"
              max={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.max}
              min={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.min}
              step={VOICE_SETTINGS_RANGES.webAnswerMaxSentences.step}
              value={settings.webAnswerMaxSentences}
              valueText={`${settings.webAnswerMaxSentences} sentence${
                settings.webAnswerMaxSentences === 1 ? "" : "s"
              }`}
              onPreview={(webAnswerMaxSentences) => {
                draggingRef.current.add("webAnswerMaxSentences");
                markInteraction();
                setSettings((current) => ({ ...current, webAnswerMaxSentences }));
              }}
              onCommit={(webAnswerMaxSentences) =>
                void commit("webAnswerMaxSentences", webAnswerMaxSentences)}
            />
            <p className="px-1 text-xs leading-snug text-neutral-500">
              How long a spoken web answer may run. Device control replies stay terse; this only
              lengthens answers {agentName} looks up online.
            </p>
          </div>
        </>
      ) : null}

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Conversation window"
          ariaValueText={`${settings.conversationIdleSeconds} seconds`}
          color={[80, 240, 160]}
          intensity={100}
          label="Conversation window"
          max={VOICE_SETTINGS_RANGES.conversationIdleSeconds.max}
          min={VOICE_SETTINGS_RANGES.conversationIdleSeconds.min}
          step={VOICE_SETTINGS_RANGES.conversationIdleSeconds.step}
          value={settings.conversationIdleSeconds}
          valueText={`${settings.conversationIdleSeconds}s`}
          onPreview={(conversationIdleSeconds) => {
            draggingRef.current.add("conversationIdleSeconds");
            markInteraction();
            setSettings((current) => ({ ...current, conversationIdleSeconds }));
          }}
          onCommit={(conversationIdleSeconds) =>
            void commit("conversationIdleSeconds", conversationIdleSeconds)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How long a conversation stays open after {agentName}&apos;s last turn before the wake
          word is needed again.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Conversation limit"
          ariaValueText={`${settings.conversationMaxSeconds} seconds`}
          color={[80, 240, 160]}
          intensity={100}
          label="Conversation limit"
          max={VOICE_SETTINGS_RANGES.conversationMaxSeconds.max}
          min={VOICE_SETTINGS_RANGES.conversationMaxSeconds.min}
          step={VOICE_SETTINGS_RANGES.conversationMaxSeconds.step}
          value={settings.conversationMaxSeconds}
          valueText={`${settings.conversationMaxSeconds}s`}
          onPreview={(conversationMaxSeconds) => {
            draggingRef.current.add("conversationMaxSeconds");
            markInteraction();
            setSettings((current) => ({ ...current, conversationMaxSeconds }));
          }}
          onCommit={(conversationMaxSeconds) =>
            void commit("conversationMaxSeconds", conversationMaxSeconds)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Longest a conversation may run before the wake word is needed again, however much is
          said.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Playback preroll"
          ariaValueText={`${settings.ttsPrerollMs} milliseconds`}
          color={[240, 100, 100]}
          intensity={100}
          label="Playback preroll"
          max={VOICE_SETTINGS_RANGES.ttsPrerollMs.max}
          min={VOICE_SETTINGS_RANGES.ttsPrerollMs.min}
          step={VOICE_SETTINGS_RANGES.ttsPrerollMs.step}
          value={settings.ttsPrerollMs}
          valueText={`${settings.ttsPrerollMs}ms`}
          onPreview={(ttsPrerollMs) => {
            draggingRef.current.add("ttsPrerollMs");
            markInteraction();
            setSettings((current) => ({ ...current, ttsPrerollMs }));
          }}
          onCommit={(ttsPrerollMs) => void commit("ttsPrerollMs", ttsPrerollMs)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How much audio a satellite buffers before it starts speaking. Lower starts responses
          sooner; raise it if replies start to stutter.
        </p>
      </div>

      <div className="grid gap-1.5">
        <SliderControlPanel
          ariaLabel="Audio frame size"
          ariaValueText={`${settings.ttsFrameMs} milliseconds`}
          color={[255, 140, 60]}
          intensity={100}
          label="Audio frame size"
          max={VOICE_SETTINGS_RANGES.ttsFrameMs.max}
          min={VOICE_SETTINGS_RANGES.ttsFrameMs.min}
          step={VOICE_SETTINGS_RANGES.ttsFrameMs.step}
          value={settings.ttsFrameMs}
          valueText={`${settings.ttsFrameMs}ms`}
          onPreview={(ttsFrameMs) => {
            draggingRef.current.add("ttsFrameMs");
            markInteraction();
            setSettings((current) => ({ ...current, ttsFrameMs }));
          }}
          onCommit={(ttsFrameMs) => void commit("ttsFrameMs", ttsFrameMs)}
        />
        <p className="px-1 text-xs leading-snug text-neutral-500">
          Size of the steady-state audio chunks sent to satellites after the first. Smaller
          trades a little network overhead for smoother pacing.
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="mt-2 text-xs font-black uppercase text-neutral-400">Speaker matching</p>
        <p className="px-1 text-xs leading-snug text-neutral-500">
          How readily {agentName} treats a voice as an already-known person. These are cosine-similarity
          thresholds (0–1) on the local TitaNet voice embeddings. Loosen them when one person is being
          split into a new profile across different microphones, rooms, and distances; tighten them if
          different people start getting mixed up. The tick on each slider marks the default — drag near
          it to snap back.
        </p>
      </div>

      {SPEAKER_MATCH_SLIDERS.map((slider) => {
        const range = VOICE_SETTINGS_RANGES[slider.key];
        const current = settings[slider.key];
        return (
          <div key={slider.key} className="grid gap-1.5">
            <SliderControlPanel
              ariaLabel={slider.label}
              ariaValueText={current.toFixed(2)}
              color={slider.color}
              intensity={100}
              label={slider.label}
              max={range.max}
              min={range.min}
              step={range.step}
              markers={[{
                value: range.default,
                label: `default ${range.default.toFixed(2)}`,
                active: current === range.default,
              }]}
              snapValue={range.default}
              value={current}
              valueText={current.toFixed(2)}
              onPreview={(next) => {
                draggingRef.current.add(slider.key);
                markInteraction();
                setSettings((currentSettings) => ({ ...currentSettings, [slider.key]: next }));
              }}
              onCommit={(next) => void commit(slider.key, next)}
            />
            <p className="px-1 text-xs leading-snug text-neutral-500">{slider.note}</p>
          </div>
        );
      })}

      {message ? (
        <p
          role="status"
          className={`text-sm font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

// Health-and-connectivity section for the voice stack: the voice server's own
// reachability and every satellite that captures speech and plays responses,
// plus the global voice-pipeline tuning (conversation window and playback
// shaping) at the bottom. Kept as its own accordion above Voice Agent so the
// personality settings are not crowded by live status that polls on its own
// cadence.
export function VoiceInfrastructureConfig({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  return (
    <ConfigAccordion
      id="voice-infrastructure"
      title="Voice Infrastructure"
      icon={<RadioTower className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Live health of the voice server and the satellites that capture speech and play responses.
        Expand to check reachability or reconnect a satellite that has dropped off.
      </p>

      <VoiceKillswitch initialSettings={initialSettings} />

      <div className="mb-4">
        <VoiceServerStatus />
      </div>
      <SatellitePanel />
      <EngineVoicesPanel />
      <VoicePipelineSettings initialSettings={initialSettings} />
    </ConfigAccordion>
  );
}
