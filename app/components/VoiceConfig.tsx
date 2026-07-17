"use client";

import { AudioLines, Plus, RefreshCw, Satellite, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PERSONALITY_MAX_LENGTH,
  VOICE_ACCENTS,
  VOICE_EMOTIONS,
  VOICE_LANGUAGES,
  VOICE_SETTINGS_RANGES,
  VOICE_SPEAKERS,
  WAKE_PREFIXES_PATTERN,
  WAKE_WORD_PATTERN,
  WAKE_WORDS_MAX,
  normalizeVoiceSettings,
  type VoiceAccent,
  type VoiceEmotion,
  type VoiceLanguage,
  type VoiceSettings,
  type VoiceSpeaker,
} from "../../lib/voice-settings";
import type { VoicePreferences } from "../../lib/types";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { useAgentName } from "./AgentNameContext";

type SyncResult = { ok: boolean; error?: string };

type VoiceRoomOption = { id: string; name: string };

type SatelliteRow = {
  configuredRoomId: string;
  enabled: boolean;
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
        and reconnects to the voice server by itself.
      </p>
    </div>
  );
}

function SelectControl<T extends string>({
  detail,
  label,
  onChange,
  options,
  value,
}: {
  detail: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
      <span>{label}</span>
      <select
        className="cyber-text-input"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        {detail}
      </span>
    </label>
  );
}

type VoiceOption = { value: string; label: string; detail?: string };

function TextControl({
  detail,
  invalidDetail = "Letters only — try a short real word.",
  label,
  maxLength,
  normalize = (candidate: string) => candidate.trim().toLowerCase(),
  onCommit,
  pattern,
  value,
}: {
  detail: string;
  invalidDetail?: string;
  label: string;
  maxLength?: number;
  normalize?: (candidate: string) => string;
  onCommit: (value: string) => void;
  pattern: RegExp;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const candidate = normalize(draft);
    if (!pattern.test(candidate)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (candidate !== value) {
      onCommit(candidate);
    }
  };
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
      <span>{label}</span>
      <input
        className={`cyber-text-input ${invalid ? "border-red-500" : ""}`}
        maxLength={maxLength}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {invalid || detail ? (
        <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
          {invalid ? invalidDetail : detail}
        </span>
      ) : null}
    </label>
  );
}

function WakeWordsControl({
  onCommit,
  value,
}: {
  onCommit: (value: string[]) => void;
  value: string[];
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  const add = () => {
    const candidate = draft.trim().toLowerCase();
    if (!WAKE_WORD_PATTERN.test(candidate)) {
      setInvalid("Use 2–24 letters.");
      return;
    }
    if (value.includes(candidate)) {
      setInvalid("That word is already in the list.");
      return;
    }
    if (value.length >= WAKE_WORDS_MAX) {
      setInvalid(`Keep at most ${WAKE_WORDS_MAX} wake words.`);
      return;
    }
    setDraft("");
    setInvalid(null);
    onCommit([...value, candidate]);
  };

  const remove = (word: string) => {
    if (value.length <= 1) {
      return;
    }
    setInvalid(null);
    onCommit(value.filter((candidate) => candidate !== word));
  };

  return (
    <div className="grid gap-1.5 text-xs font-black uppercase text-neutral-400 sm:col-span-2">
      <span>Wake words</span>
      <div className="flex flex-wrap gap-2">
        {value.map((word) => (
          <span key={word} className="flex items-center gap-1 border border-cyan-300/40 bg-neutral-900 px-2 py-1.5 text-cyan-100">
            {word}
            <button
              type="button"
              className="text-neutral-400 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Remove ${word}`}
              disabled={value.length <= 1}
              onClick={() => remove(word)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={`cyber-text-input min-w-0 flex-1 ${invalid ? "border-red-500" : ""}`}
          aria-label="Add wake word"
          maxLength={24}
          placeholder="Add word"
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <MomentaryFeedbackButton
          type="button"
          className="config-page-button"
          disabled={!draft.trim() || value.length >= WAKE_WORDS_MAX}
          onClick={add}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </MomentaryFeedbackButton>
      </div>
      {invalid ? <span className="font-sans font-normal normal-case text-red-200">{invalid}</span> : null}
    </div>
  );
}

function TextAreaControl({
  detail,
  label,
  maxLength,
  onCommit,
  placeholder,
  value,
}: {
  detail: string;
  label: string;
  maxLength: number;
  onCommit: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    const candidate = draft.slice(0, maxLength).trim();
    if (candidate !== value) {
      onCommit(candidate);
    }
  };
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400 sm:col-span-2">
      <span>{label}</span>
      <textarea
        className="cyber-text-input min-h-20 resize-y font-sans normal-case"
        maxLength={maxLength}
        placeholder={placeholder}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        {detail}
      </span>
    </label>
  );
}

export function VoiceConfig({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const [settings, setSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialSettings));
  const { agentName, setAgentName } = useAgentName();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const [voiceOptions, setVoiceOptions] = useState<readonly VoiceOption[]>(VOICE_SPEAKERS);
  const [optionsSource, setOptionsSource] = useState<"static" | "iridium" | "fallback">("static");
  const draggingRef = useRef(new Set<keyof VoiceSettings>());
  const requestVersionRef = useRef(0);

  // Iridium publishes the voices its deployed TTS stack actually supports;
  // populate the dropdown from it and keep the static list as the fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/voice/options", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const data = await response.json() as { source?: string; voices?: VoiceOption[] };
        if (!cancelled && Array.isArray(data.voices) && data.voices.length > 0) {
          setVoiceOptions(data.voices);
          setOptionsSource(data.source === "iridium" ? "iridium" : "fallback");
        }
      } catch (error) {
        console.error("[nova-dashboard] failed to load voice options", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (draggingRef.current.size > 0) {
      return;
    }
    try {
      const response = await fetch("/api/voice", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Voice settings request failed: ${response.status}`);
      }
      const data = await response.json() as { voice?: VoicePreferences };
      if (draggingRef.current.size === 0) {
        const next = normalizeVoiceSettings(data.voice);
        setSettings(next);
        setAgentName(next.agentName);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice settings", error);
    }
  }, [setAgentName]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(async <K extends keyof Omit<VoiceSettings, "updatedAt">>(
    key: K,
    value: VoiceSettings[K],
  ) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    draggingRef.current.delete(key);
    setSettings((current) => ({ ...current, [key]: value }));
    const displayName = key === "agentName" && typeof value === "string" ? value : agentName;
    if (key === "agentName" && typeof value === "string") {
      setAgentName(value);
    }
    setMessage(`Saving on ${displayName} and notifying Iridium…`);
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
      if (
        requestVersion === requestVersionRef.current
        && data.voice
        && draggingRef.current.size === 0
      ) {
        const next = normalizeVoiceSettings(data.voice);
        setSettings(next);
        setAgentName(next.agentName);
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.iridium?.ok) {
        setMessage(`Saved on ${displayName} and applied live on Iridium.`);
        setMessageTone("ok");
      } else {
        setMessage(`Saved on ${displayName}. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to update voice settings");
      setMessageTone("error");
    }
  }, [agentName, setAgentName]);

  const selectedSpeaker = voiceOptions.find(({ value }) => value === settings.speaker);

  return (
    <ConfigAccordion
      id="voice"
      title="Voice Agent"
      icon={<AudioLines className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Shape the voice agent&apos;s speech and language model with explicit controls. {agentName} stores each
        change, then signals Iridium to collect and apply the complete setting set without restarting
        the voice service.
        {optionsSource === "iridium" ? " Voice list published live by Iridium." : null}
      </p>

      <SatellitePanel />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <WakeWordsControl
          value={settings.wakeWords}
          onCommit={(wakeWords) => void commit("wakeWords", wakeWords)}
        />
        <TextControl
          label="Wake prefixes"
          value={settings.wakePrefixes}
          pattern={WAKE_PREFIXES_PATTERN}
          detail="Space-separated greetings accepted before the wake word (e.g. hey ok yo)."
          onCommit={(wakePrefixes) => void commit("wakePrefixes", wakePrefixes)}
        />
        <SelectControl<VoiceSpeaker>
          label="Voice"
          value={settings.speaker}
          options={voiceOptions as readonly { label: string; value: VoiceSpeaker }[]}
          detail={selectedSpeaker?.detail ?? "Qwen CustomVoice preset"}
          onChange={(speaker) => void commit("speaker", speaker)}
        />
        <SelectControl<VoiceLanguage>
          label="Language"
          value={settings.language}
          options={VOICE_LANGUAGES}
          detail="Sets pronunciation and text interpretation for generated speech."
          onChange={(language) => void commit("language", language)}
        />
        <SelectControl<VoiceAccent>
          label="Accent"
          value={settings.accent}
          options={VOICE_ACCENTS}
          detail="Guides accent while preserving the selected voice's timbre."
          onChange={(accent) => void commit("accent", accent)}
        />
        <SelectControl<VoiceEmotion>
          label="Baseline mood"
          value={settings.emotion}
          options={VOICE_EMOTIONS}
          detail={`Sets ${agentName}'s resting delivery before conversational emotion is blended in.`}
          onChange={(emotion) => void commit("emotion", emotion)}
        />
        <TextAreaControl
          label="Personality description"
          value={settings.personality}
          maxLength={PERSONALITY_MAX_LENGTH}
          placeholder="You are a bright, bubbly helper!"
          detail="Included with the language model's system prompt to shape how the agent behaves and speaks. Clear it to run with the stock prompt."
          onCommit={(personality) => void commit("personality", personality)}
        />
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Speech speed"
            ariaValueText={`${settings.speechRate} percent`}
            color={[60, 220, 240]}
            intensity={100}
            label="Speech speed"
            max={VOICE_SETTINGS_RANGES.speechRate.max}
            min={VOICE_SETTINGS_RANGES.speechRate.min}
            step={VOICE_SETTINGS_RANGES.speechRate.step}
            value={settings.speechRate}
            valueText={`${settings.speechRate}%`}
            onChange={(speechRate) => {
              draggingRef.current.add("speechRate");
              setSettings((current) => ({ ...current, speechRate }));
            }}
            onCommit={(speechRate) => void commit("speechRate", speechRate)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">100% is {agentName}&apos;s natural pace.</p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Voice pitch"
            ariaValueText={`${settings.pitch > 0 ? "+" : ""}${settings.pitch} percent`}
            color={[180, 95, 240]}
            fill={false}
            intensity={100}
            label="Pitch"
            markers={[
              { label: "Lower", value: -20 },
              { active: settings.pitch === 0, label: "Natural", value: 0 },
              { label: "Higher", value: 20 },
            ]}
            max={VOICE_SETTINGS_RANGES.pitch.max}
            min={VOICE_SETTINGS_RANGES.pitch.min}
            step={VOICE_SETTINGS_RANGES.pitch.step}
            value={settings.pitch}
            valueText={`${settings.pitch > 0 ? "+" : ""}${settings.pitch}%`}
            onChange={(pitch) => {
              draggingRef.current.add("pitch");
              setSettings((current) => ({ ...current, pitch }));
            }}
            onCommit={(pitch) => void commit("pitch", pitch)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">Moves the delivery lower or brighter without changing voice.</p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Emotion mirroring strength"
            ariaValueText={`${settings.emotionMirroring} percent`}
            color={[255, 0, 187]}
            intensity={100}
            label="Emotion response"
            max={VOICE_SETTINGS_RANGES.emotionMirroring.max}
            min={VOICE_SETTINGS_RANGES.emotionMirroring.min}
            step={VOICE_SETTINGS_RANGES.emotionMirroring.step}
            value={settings.emotionMirroring}
            valueText={`${settings.emotionMirroring}%`}
            onChange={(emotionMirroring) => {
              draggingRef.current.add("emotionMirroring");
              setSettings((current) => ({ ...current, emotionMirroring }));
            }}
            onCommit={(emotionMirroring) => void commit("emotionMirroring", emotionMirroring)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            0% stays at the baseline mood; 100% follows detected emotion; 200% heightens it.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Language model temperature"
            ariaValueText={settings.temperature.toFixed(1)}
            color={[240, 160, 60]}
            intensity={100}
            label="LLM temperature"
            max={VOICE_SETTINGS_RANGES.temperature.max}
            min={VOICE_SETTINGS_RANGES.temperature.min}
            step={VOICE_SETTINGS_RANGES.temperature.step}
            value={settings.temperature}
            valueText={settings.temperature.toFixed(1)}
            onChange={(temperature) => {
              draggingRef.current.add("temperature");
              setSettings((current) => ({ ...current, temperature }));
            }}
            onCommit={(temperature) => void commit("temperature", temperature)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            0.0 keeps spoken replies deterministic and cacheable; higher values vary the phrasing.
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
            onChange={(conversationIdleSeconds) => {
              draggingRef.current.add("conversationIdleSeconds");
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
            ariaLabel="Daytime voice volume"
            ariaValueText={`${settings.volumeDay} percent`}
            color={[255, 200, 60]}
            intensity={100}
            label="Daytime volume"
            max={VOICE_SETTINGS_RANGES.volumeDay.max}
            min={VOICE_SETTINGS_RANGES.volumeDay.min}
            step={VOICE_SETTINGS_RANGES.volumeDay.step}
            value={settings.volumeDay}
            valueText={`${settings.volumeDay}%`}
            onChange={(volumeDay) => {
              draggingRef.current.add("volumeDay");
              setSettings((current) => ({ ...current, volumeDay }));
            }}
            onCommit={(volumeDay) => void commit("volumeDay", volumeDay)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Playback loudness for spoken responses from 8 am to 9 pm.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Nighttime voice volume"
            ariaValueText={`${settings.volumeNight} percent`}
            color={[110, 130, 255]}
            intensity={100}
            label="Nighttime volume"
            max={VOICE_SETTINGS_RANGES.volumeNight.max}
            min={VOICE_SETTINGS_RANGES.volumeNight.min}
            step={VOICE_SETTINGS_RANGES.volumeNight.step}
            value={settings.volumeNight}
            valueText={`${settings.volumeNight}%`}
            onChange={(volumeNight) => {
              draggingRef.current.add("volumeNight");
              setSettings((current) => ({ ...current, volumeNight }));
            }}
            onCommit={(volumeNight) => void commit("volumeNight", volumeNight)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Playback loudness for spoken responses from 9 pm to 8 am, so overnight replies stay quiet.
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
            onChange={(ttsPrerollMs) => {
              draggingRef.current.add("ttsPrerollMs");
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
            onChange={(ttsFrameMs) => {
              draggingRef.current.add("ttsFrameMs");
              setSettings((current) => ({ ...current, ttsFrameMs }));
            }}
            onCommit={(ttsFrameMs) => void commit("ttsFrameMs", ttsFrameMs)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Size of the steady-state audio chunks sent to satellites after the first. Smaller
            trades a little network overhead for smoother pacing.
          </p>
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-4 text-sm font-semibold ${
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
    </ConfigAccordion>
  );
}
