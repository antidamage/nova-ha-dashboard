"use client";

import { Check, Power, PowerOff, RadioTower, RefreshCw, Satellite } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  VOICE_SETTINGS_RANGES,
  normalizeVoiceSettings,
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

function satelliteStatusText(row: SatelliteRow, iridiumOk: boolean) {
  if (!iridiumOk) {
    return { text: "Status unavailable — Iridium unreachable", tone: "warning" as const };
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
  const [iridiumOk, setIridiumOk] = useState(true);
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
        iridium?: { ok?: boolean };
        rooms?: VoiceRoomOption[];
        satellites?: SatelliteRow[];
      };
      setSatellites(Array.isArray(data.satellites) ? data.satellites : []);
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
      setIridiumOk(data.iridium?.ok !== false);
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
        const status = satelliteStatusText(row, iridiumOk);
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

type SyncResult = { ok: boolean; error?: string };
type PipelineKey = "conversationIdleSeconds" | "ttsPrerollMs" | "ttsFrameMs";
type PipelineSettingKey = PipelineKey | "satelliteNoiseGateEnabled" | "speakerRecognitionEnabled";

// System-wide voice killswitch. A single master on/off for the whole household:
// when off, Iridium drops every microphone frame and closes the open
// conversation, so voice is fully disabled everywhere until it is turned back
// on. This is the shared, host-backed setting (POSTed to /api/voice, then pulled
// by Iridium) — distinct from the per-device browser voice-input toggle.
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
        ? "Turning voice on and notifying Iridium…"
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
        iridium?: SyncResult;
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
      if (data.iridium?.ok) {
        setMessage(
          next
            ? "Voice is ON — the whole system is listening again."
            : "Voice is OFF — every microphone is ignored system-wide and the conversation was closed.",
        );
        setMessageTone(next ? "ok" : "warning");
      } else {
        setMessage(`Saved on ${agentName}. ${data.iridium?.error ?? "Iridium did not confirm the change."}`);
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
// notifies Iridium), exactly like the Voice Agent controls; the two sections edit
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

  const commit = useCallback(async (key: PipelineSettingKey, value: number | boolean) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    if (key !== "satelliteNoiseGateEnabled" && key !== "speakerRecognitionEnabled") {
      draggingRef.current.delete(key);
    }
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(`Saving on ${agentName} and notifying Iridium…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify({ [key]: value }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as {
        error?: string;
        iridium?: SyncResult;
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
      if (data.iridium?.ok) {
        setMessage(`Saved on ${agentName} and applied live on Iridium.`);
        setMessageTone("ok");
      } else {
        setMessage(`Saved on ${agentName}. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
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
      <VoicePipelineSettings initialSettings={initialSettings} />
    </ConfigAccordion>
  );
}
