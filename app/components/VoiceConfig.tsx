"use client";

import { AudioLines, Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PERSONALITY_MAX_LENGTH,
  PRONOUN_MAX_LENGTH,
  PRONOUN_PATTERN,
  TRANSCRIPT_TEMPLATE_MAX_LENGTH,
  ENGINE_VOICE_FIELD,
  VOICE_ACCENTS,
  VOICE_AFFECTATION_GROUPS,
  VOICE_EMOTIONS,
  VOICE_ENGINE_CAPABILITIES,
  VOICE_ENGINES,
  VOICE_LANGUAGES,
  VOICE_PRONOUN_PRESETS,
  VOICE_SETTINGS_RANGES,
  VOICE_SPEAKERS,
  WAKE_PREFIXES_PATTERN,
  WAKE_WORD_PATTERN,
  WAKE_WORDS_MAX,
  normalizeVoiceSettings,
  voicePersonalitySignature,
  voicePersonalitySubset,
  type VoiceAccent,
  type VoiceAffectations,
  type VoiceEmotion,
  type VoiceLanguage,
  type VoiceEngine,
  type VoiceEngineDescriptor,
  type VoicePersonalitySet,
  type VoicePronouns,
  type VoiceSettings,
  type VoiceSpeaker,
} from "../../lib/voice-settings";
import { VoicePersonalityLibraryControl } from "./VoicePersonalityLibraryControl";
import { useVoicePersonalityLibrary } from "./voicePersonalityLibrary";
import {
  DEFAULT_TRANSCRIPT_TEMPLATE,
  formatVoiceTranscriptLine,
} from "../../lib/voice-transcript";
import type { VoicePreferences } from "../../lib/types";
import { ConfigAccordion, SliderControlPanel } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { useAgentName } from "./AgentNameContext";
import { useSettingCooldown } from "./useSettingCooldown";

type SyncResult = { ok: boolean; error?: string };

const VOICE_ENGINE_VALUES = new Set<string>(VOICE_ENGINES.map(({ value }) => value));
function isVoiceEngine(value: unknown): value is VoiceEngine {
  return typeof value === "string" && VOICE_ENGINE_VALUES.has(value);
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

function TranscriptTemplateControl({
  agentName,
  onCommit,
  value,
}: {
  agentName: string;
  onCommit: (value: string) => void;
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    const candidate = draft.slice(0, TRANSCRIPT_TEMPLATE_MAX_LENGTH);
    if (candidate.trim() !== value.trim()) {
      onCommit(candidate);
    }
  };
  const preview = useMemo(() => {
    const template = draft.trim() ? draft : DEFAULT_TRANSCRIPT_TEMPLATE;
    const at = new Date().toISOString();
    const user = formatVoiceTranscriptLine(
      { id: "preview-user", at, role: "user", text: "Turn the lounge light on" },
      agentName,
      template,
    );
    const agent = formatVoiceTranscriptLine(
      { id: "preview-agent", at, role: "assistant", text: "Done.", agentName, kind: "command" },
      agentName,
      template,
    );
    return `${user}\n${agent}`;
  }, [agentName, draft]);
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase text-neutral-400">
      <span>Transcript decoration</span>
      <input
        className="cyber-text-input font-mono normal-case"
        maxLength={TRANSCRIPT_TEMPLATE_MAX_LENGTH}
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
      <pre className="whitespace-pre-wrap break-words border border-cyan-300/20 bg-neutral-900/80 p-2 font-mono text-xs font-normal normal-case leading-relaxed text-cyan-100">
        {preview}
      </pre>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        Header decoration for live transcript lines. %u% is the user label (user lines only),
        %a% is the agent label (agent lines only), %d% the date, %t% the time, and %m% the turn
        mode (COMMAND or EXCHANGE). The ╰─ body lead-in is fixed. Clear the field to restore the
        stock decoration.
      </span>
    </label>
  );
}

function PronounsControl({
  onCommit,
  value,
}: {
  onCommit: (value: VoicePronouns) => void;
  value: VoicePronouns;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const commit = (next: VoicePronouns) => {
    const normalized: VoicePronouns = {
      subjective: next.subjective.trim().toLowerCase(),
      objective: next.objective.trim().toLowerCase(),
      possessive: next.possessive.trim().toLowerCase(),
    };
    const valid =
      PRONOUN_PATTERN.test(normalized.subjective)
      && PRONOUN_PATTERN.test(normalized.objective)
      && PRONOUN_PATTERN.test(normalized.possessive);
    if (!valid) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (
      normalized.subjective !== value.subjective
      || normalized.objective !== value.objective
      || normalized.possessive !== value.possessive
    ) {
      onCommit(normalized);
    }
  };

  const presetLabel = `${value.subjective}/${value.objective}/${value.possessive}`;
  const forms: { key: keyof VoicePronouns; label: string; example: string }[] = [
    { key: "subjective", label: "Subjective", example: "she / they / xe" },
    { key: "objective", label: "Objective", example: "her / them / xem" },
    { key: "possessive", label: "Possessive", example: "hers / theirs / xyrs" },
  ];

  return (
    <div className="grid gap-1.5 text-xs font-black uppercase text-neutral-400 sm:col-span-2">
      <span>Pronouns</span>
      <div className="flex flex-wrap items-end gap-3">
        {forms.map((form) => (
          <label key={form.key} className="grid min-w-24 flex-1 gap-1">
            <span className="text-[0.65rem] text-neutral-500">{form.label}</span>
            <input
              className={`cyber-text-input font-sans normal-case ${invalid ? "border-red-500" : ""}`}
              type="text"
              maxLength={PRONOUN_MAX_LENGTH}
              value={draft[form.key]}
              aria-label={`${form.label} pronoun`}
              placeholder={form.example}
              onChange={(event) => setDraft((current) => ({ ...current, [form.key]: event.target.value }))}
              onBlur={() => commit(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commit(draft);
                  (event.target as HTMLInputElement).blur();
                }
              }}
            />
          </label>
        ))}
        <label className="grid gap-1">
          <span className="text-[0.65rem] text-neutral-500">Presets</span>
          <select
            className="cyber-text-input"
            aria-label="Pronoun preset"
            value={VOICE_PRONOUN_PRESETS.some((preset) =>
              preset.value.subjective === value.subjective
              && preset.value.objective === value.objective
              && preset.value.possessive === value.possessive)
              ? presetLabel
              : ""}
            onChange={(event) => {
              const preset = VOICE_PRONOUN_PRESETS.find((item) =>
                `${item.value.subjective}/${item.value.objective}/${item.value.possessive}` === event.target.value);
              if (preset) {
                setDraft(preset.value);
                commit(preset.value);
              }
            }}
          >
            <option value="">Custom…</option>
            {VOICE_PRONOUN_PRESETS.map((preset) => (
              <option
                key={preset.label}
                value={`${preset.value.subjective}/${preset.value.objective}/${preset.value.possessive}`}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        {invalid
          ? "Each form must be a short word (letters, apostrophes, or hyphens)."
          : "The three third-person forms the agent uses for itself. Each is labelled by grammatical role so neo-pronoun sets are passed to the language model exactly, not guessed."}
      </span>
    </div>
  );
}

function AffectationsControl({
  onCommit,
  value,
}: {
  onCommit: (value: VoiceAffectations) => void;
  value: VoiceAffectations;
}) {
  return (
    <div className="grid gap-1.5 text-xs font-black uppercase text-neutral-400 sm:col-span-2">
      <span>Affectations</span>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {VOICE_AFFECTATION_GROUPS.map((group) => (
          <fieldset key={group.label} className="grid min-w-48 content-start gap-1.5">
            <legend className="mb-1 text-[0.65rem] text-neutral-500">{group.label}</legend>
            {group.options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 font-sans text-xs font-normal normal-case text-neutral-300"
              >
                <input
                  type="checkbox"
                  className="cyber-mini-checkbox-input"
                  checked={value[option.value]}
                  onChange={(event) => onCommit({ ...value, [option.value]: event.target.checked })}
                />
                <span className="cyber-mini-checkbox" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3.5} />
                </span>
                <span>
                  {option.label}
                  <span className="block leading-snug text-neutral-500">{option.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <span className="font-sans text-xs font-normal normal-case leading-snug text-neutral-500">
        Speech quirks applied to every finished reply before it is spoken or transcribed.
        Saved and loaded with the personality.
      </span>
    </div>
  );
}

export function VoiceConfig({ initialSettings }: { initialSettings?: VoicePreferences | null }) {
  const [settings, setSettings] = useState<VoiceSettings>(() => normalizeVoiceSettings(initialSettings));
  const { agentName, setAgentName, setTranscriptTemplate } = useAgentName();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");
  const [voiceOptions, setVoiceOptions] = useState<readonly VoiceOption[]>(VOICE_SPEAKERS);
  const [optionsSource, setOptionsSource] = useState<"static" | "iridium" | "fallback">("static");
  // Active TTS engine module. Which voice controls render (preset dropdown vs
  // a cloned/trained-voice dropdown, accent/mood, diffusion steps) is decided
  // by this engine's capabilities below, not a hardcoded engine-id check.
  const [engine, setEngine] = useState<VoiceEngine>("classic");
  // The server's live engine list (id/label/capabilities), from the same
  // registry manifest the engine picker and switch machinery use. Falls back
  // to the static VOICE_ENGINE_CAPABILITIES map (no capabilities server data
  // yet) so the panel still renders sensibly before the first successful poll.
  const [engines, setEngines] = useState<readonly VoiceEngineDescriptor[]>([]);
  // Prefers the server's live label (matches the engine that's actually
  // deployed) over the static fallback, so display text never drifts from
  // reality even if VOICE_ENGINES's copy goes stale.
  const engineLabel = useCallback((id: string) =>
    engines.find((entry) => entry.id === id)?.label
    ?? VOICE_ENGINES.find((entry) => entry.value === id)?.label
    ?? id, [engines]);
  // Engine switcher state. `pendingEngine` is a radio selection awaiting the
  // explicit confirm (a switch restarts voice services, so it never fires from
  // a single click); `switchTarget` is a swap in flight, followed by polling
  // /api/voice/engine — the voice server restarts mid-swap, so unreachable
  // polls are an expected phase, not an error.
  const [pendingEngine, setPendingEngine] = useState<VoiceEngine | null>(null);
  const [switchTarget, setSwitchTarget] = useState<VoiceEngine | null>(null);
  const [switchNote, setSwitchNote] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  const draggingRef = useRef(new Set<keyof VoiceSettings>());
  const requestVersionRef = useRef(0);
  // After any control is used, hold off the 30s poll for a few seconds so an
  // in-flight refresh can't rubber-band the value back (draggingRef only covers
  // the active drag; this covers the window after release too).
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  // Iridium publishes the voices its deployed TTS stack actually supports;
  // populate the dropdown from it and keep the static list as the fallback.
  // Re-run after an engine switch: the voice list is per-engine (Classic
  // presets vs the Custom clone registry).
  const loadVoiceOptions = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/options", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        source?: string;
        voices?: VoiceOption[];
        engine?: string;
        engines?: VoiceEngineDescriptor[];
      };
      if (Array.isArray(data.voices) && data.voices.length > 0) {
        setVoiceOptions(data.voices);
        setOptionsSource(data.source === "iridium" ? "iridium" : "fallback");
      }
      if (Array.isArray(data.engines) && data.engines.length > 0) {
        setEngines(data.engines);
      }
      if (isVoiceEngine(data.engine)) {
        setEngine(data.engine);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice options", error);
    }
  }, []);

  useEffect(() => {
    void loadVoiceOptions();
  }, [loadVoiceOptions]);

  // Ask the voice server to swap the resident TTS engine. Acceptance is not
  // completion: the server hands the swap to its root-side switcher and
  // restarts itself, so progress is followed by the polling effect below.
  const requestEngineSwitch = useCallback(async (target: VoiceEngine) => {
    setPendingEngine(null);
    setSwitchFailed(false);
    setSwitchTarget(target);
    setSwitchNote("Asking the voice server to switch engines…");
    try {
      const response = await fetch("/api/voice/engine", {
        body: JSON.stringify({ engine: target }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        changed?: boolean;
      };
      if (!response.ok) {
        throw new Error(data.error || `Engine switch failed: ${response.status}`);
      }
      if (data.changed === false) {
        setEngine(target);
        setSwitchTarget(null);
        setSwitchNote(null);
        return;
      }
      setSwitchNote("Switch accepted — voice services are restarting…");
    } catch (error) {
      setSwitchFailed(true);
      setSwitchNote(error instanceof Error ? error.message : "Engine switch request failed");
    }
  }, []);

  useEffect(() => {
    if (switchTarget === null || switchFailed) {
      return;
    }
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const response = await fetch("/api/voice/engine", { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }
        const data = await response.json() as {
          reachable?: boolean;
          engine?: string;
          switch?: { target?: string; phase?: string; error?: string };
        };
        if (cancelled) {
          return;
        }
        if (!data.reachable) {
          setSwitchNote("Voice services are restarting…");
          return;
        }
        const phase = data.switch?.phase;
        if (phase === "failed") {
          setSwitchFailed(true);
          setSwitchNote(`Engine switch failed: ${data.switch?.error ?? "see the voice server logs"}`);
          return;
        }
        if (data.engine === switchTarget && phase === "ready") {
          setSwitchTarget(null);
          setSwitchNote(null);
          setEngine(switchTarget);
          setMessage(
            `Switched to the ${engineLabel(switchTarget)} engine.`,
          );
          setMessageTone("ok");
          void loadVoiceOptions();
          return;
        }
        setSwitchNote(
          phase === "warming"
            // The ~7 minute figure is specifically measured for the Custom
            // (dots.tts) engine's optimize=True warmup; other engines' warmup
            // time isn't asserted here until it's been measured the same way.
            ? `New engine is loading and warming up${switchTarget === "custom" ? " — Custom takes around 7 minutes…" : "…"}`
            : "Voice services are restarting…",
        );
      } catch {
        // Expected while the voice server is down mid-switch; keep polling.
      }
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [switchFailed, switchTarget, loadVoiceOptions, engineLabel]);

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
        const next = normalizeVoiceSettings(data.voice);
        setSettings(next);
        setAgentName(next.agentName);
        setTranscriptTemplate(next.transcriptTemplate);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice settings", error);
    }
  }, [isCoolingDown, setAgentName, setTranscriptTemplate]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const commit = useCallback(async <K extends keyof Omit<VoiceSettings, "updatedAt">>(
    key: K,
    value: VoiceSettings[K],
  ) => {
    markInteraction();
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
        setTranscriptTemplate(next.transcriptTemplate);
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
  }, [agentName, markInteraction, setAgentName, setTranscriptTemplate]);

  // Load a whole saved personality at once: one POST carries every
  // personality-scoped field (which then propagates to Iridium like any other
  // voice-settings change), instead of firing a request per control.
  const commitMany = useCallback(async (set: VoicePersonalitySet) => {
    markInteraction();
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    for (const key of Object.keys(set) as (keyof VoicePersonalitySet)[]) {
      draggingRef.current.delete(key);
    }
    setSettings((current) => ({ ...current, ...set }));
    setMessage(`Applying personality on ${agentName} and notifying Iridium…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice", {
        body: JSON.stringify(set),
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
        setSettings(normalizeVoiceSettings(data.voice));
      }
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      if (data.iridium?.ok) {
        setMessage(`Personality applied on ${agentName} and live on Iridium.`);
        setMessageTone("ok");
      } else {
        setMessage(`Personality applied on ${agentName}. ${data.iridium?.error ?? "Iridium did not confirm the refresh."}`);
        setMessageTone("warning");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) {
        return;
      }
      setMessage(error instanceof Error ? error.message : "Failed to apply personality");
      setMessageTone("error");
    }
  }, [agentName, markInteraction]);

  // ---- Personality library (save / load / rename / duplicate / delete) ------
  const personalityLibrary = useVoicePersonalityLibrary();
  const currentSubset = useMemo(() => voicePersonalitySubset(settings), [settings]);
  const activePersonality = useMemo(
    () =>
      personalityLibrary.library.entries.find(
        (entry) => entry.id === personalityLibrary.library.activeId,
      ) ?? null,
    [personalityLibrary.library],
  );
  const personalityDirty = useMemo(
    () =>
      activePersonality
        ? voicePersonalitySignature(currentSubset) !== voicePersonalitySignature(activePersonality.personality)
        : false,
    [activePersonality, currentSubset],
  );
  const loadPersonality = useCallback((id: string) => {
    const entry = personalityLibrary.library.entries.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    void commitMany(entry.personality);
    personalityLibrary.setActive(id);
  }, [commitMany, personalityLibrary]);

  // Audition the whole configured voice: Iridium asks the live language model a
  // random question (so temperature, personality, pronouns, and language all
  // show) and synthesizes the reply with the live voice, accent, mood, rate,
  // and pitch. Every knob is applied live, so this matches a real spoken turn.
  // The browser plays it locally — nothing is spoken through the satellites.
  const testPersonality = useCallback(async () => {
    if (switchTarget !== null && !switchFailed) {
      setMessage("An engine switch is in progress — voice preview returns once it completes.");
      setMessageTone("warning");
      return;
    }
    setMessage(`Asking ${agentName} to say something…`);
    setMessageTone("ok");
    try {
      const response = await fetch("/api/voice/preview", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Voice preview failed: ${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.addEventListener("ended", cleanup, { once: true });
      audio.addEventListener("error", cleanup, { once: true });
      await audio.play();
      setMessage(`Played ${agentName} speaking with the current settings.`);
      setMessageTone("ok");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to play a voice sample");
      setMessageTone("error");
    }
  }, [agentName, switchFailed, switchTarget]);

  // What controls to render for the active engine — from the server's live
  // engine list when available, else the static fallback map. Neither is a
  // hardcoded engine-id check, so a newly-registered engine renders correctly
  // without a dashboard code change (as long as it fits an existing
  // capability shape).
  const capabilities =
    engines.find((entry) => entry.id === engine)?.capabilities
    ?? VOICE_ENGINE_CAPABILITIES[engine];
  // The active engine decides which stored voice field the picker edits: each
  // engine has its own disjoint voice namespace (see VoiceSettings in
  // lib/voice-settings.ts) so it keeps its own last-used voice.
  const voiceField = ENGINE_VOICE_FIELD[engine];
  const activeVoiceValue = settings[voiceField];
  const selectedSpeaker = voiceOptions.find(({ value }) => value === activeVoiceValue);
  // A persisted voice id can predate the registry list (or the registry may be
  // briefly unreachable); keep it selectable rather than showing a mismatched
  // dropdown. Skip this for an empty value (e.g. no trained voice yet).
  const engineVoiceOptions =
    capabilities.usesCustomVoiceDropdown && !selectedSpeaker && activeVoiceValue
      ? [{ value: activeVoiceValue, label: activeVoiceValue }, ...voiceOptions]
      : voiceOptions;
  const switchInFlight = switchTarget !== null && !switchFailed;
  // Saved personalities are engine-scoped: the picker lists only profiles for
  // the engine currently loaded (plus legacy profiles saved before engines were
  // tracked, which have no tag yet and stay visible under any engine).
  const visiblePersonalities = personalityLibrary.library.entries.filter(
    (entry) => entry.engine == null || entry.engine === engine,
  );
  const activePersonalityVisible = visiblePersonalities.some(
    (entry) => entry.id === personalityLibrary.library.activeId,
  );

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

      <div className="mb-4 grid gap-1.5">
        <p className="text-xs font-black uppercase text-neutral-400">Voice engine</p>
        <div role="radiogroup" aria-label="Voice engine" className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {VOICE_ENGINES.map((option) => {
            const selected = (pendingEngine ?? engine) === option.value;
            return (
              <MomentaryFeedbackButton
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={switchInFlight}
                className={`cyber-checkbox-row border p-4 text-left ${
                  selected ? "cyber-checkbox-row-active" : ""
                }`}
                onClick={() => setPendingEngine(option.value === engine ? null : option.value)}
              >
                <span
                  className={`cyber-checkbox ${selected ? "cyber-checkbox-checked" : ""}`}
                  aria-hidden="true"
                >
                  {selected ? <Check className="h-6 w-6" strokeWidth={3} /> : null}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="theme-display-label zone-title-bar">
                    {option.label}
                    {engine === option.value ? " · active" : ""}
                  </span>
                  <span className="theme-display-detail">{option.detail}</span>
                </span>
              </MomentaryFeedbackButton>
            );
          })}
        </div>
        {pendingEngine !== null && pendingEngine !== engine && !switchInFlight ? (
          <div className="grid gap-2 px-1">
            <p className="font-sans text-xs leading-snug text-amber-200">
              Switching swaps which TTS model is loaded on the voice server and restarts voice
              services: expect no spoken replies for a couple of minutes
              {/* The ~7 minute figure is specifically measured for Custom's optimize=True
                  warmup; other engines' warmup time isn't asserted until measured the same way. */}
              {pendingEngine === "custom" ? ", plus around 7 minutes of Custom-engine warmup" : ""}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="system-confirm-go"
                onClick={() => void requestEngineSwitch(pendingEngine)}
              >
                Switch to {engineLabel(pendingEngine)}
              </button>
              <button
                type="button"
                className="system-confirm-cancel"
                onClick={() => setPendingEngine(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {switchNote ? (
          <p
            role="status"
            className={`px-1 font-sans text-xs leading-snug ${
              switchFailed ? "text-red-200" : "text-amber-200"
            }`}
          >
            {switchNote}
          </p>
        ) : null}
        <p className="px-1 font-sans text-xs leading-snug text-neutral-500">
          One TTS engine is loaded on the voice server&apos;s GPU at a time. Classic offers the
          built-in preset voices with accent and mood shaping; Custom speaks with voices cloned
          zero-shot from your reference clips; Trained speaks with voices fine-tuned from hundreds
          of your own samples. Each engine remembers its own voice selection, and any of them can
          be restored at any time.
        </p>
        {capabilities.usesNumSteps ? (
          <div className="grid gap-1.5 px-1 pt-1">
            <SliderControlPanel
              ariaLabel={`${engineLabel(engine)} engine diffusion steps`}
              ariaValueText={`${settings.dotsNumSteps} steps`}
              color={[190, 90, 100]}
              intensity={100}
              label="Streaming steps"
              max={VOICE_SETTINGS_RANGES.dotsNumSteps.max}
              min={VOICE_SETTINGS_RANGES.dotsNumSteps.min}
              step={VOICE_SETTINGS_RANGES.dotsNumSteps.step}
              value={settings.dotsNumSteps}
              valueText={`${settings.dotsNumSteps} steps`}
              onPreview={(dotsNumSteps) => {
                draggingRef.current.add("dotsNumSteps");
                markInteraction();
                setSettings((current) => ({ ...current, dotsNumSteps }));
              }}
              onCommit={(dotsNumSteps) => void commit("dotsNumSteps", dotsNumSteps)}
            />
            <p className="font-sans text-xs leading-snug text-neutral-500">
              How many diffusion steps the {engineLabel(engine)} engine runs per reply. Fewer steps
              reach the first audio sooner and use less GPU, at some quality cost; more steps are
              smoother but slower to start. Only affects engines with a diffusion sampler.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid gap-1.5">
        <p className="text-xs font-black uppercase text-neutral-400">Personality</p>
        <VoicePersonalityLibraryControl
          activeId={activePersonalityVisible ? personalityLibrary.library.activeId : null}
          dirty={personalityDirty}
          entries={visiblePersonalities}
          onLoad={loadPersonality}
          onSaveChanges={() => personalityLibrary.saveChanges(currentSubset)}
          onSaveAs={(name) => personalityLibrary.saveAs(name, currentSubset, engine)}
          onRename={(id, name) => personalityLibrary.rename(id, name)}
          onDuplicate={(id) => personalityLibrary.duplicate(id)}
          onDelete={(id) => personalityLibrary.remove(id)}
          onTest={testPersonality}
        />
        <p className="font-sans text-xs leading-snug text-neutral-500">
          A personality bundles the voice, language, accent, baseline mood, description, pronouns,
          affectations, and speech shaping below, and is tied to the engine it was saved under —
          only {engineLabel(engine)} profiles show here. Load one to apply it
          live; the agent name, wake words, volume, and conversation window stay global. Save
          captures the current settings back into the selected personality. Test asks {agentName} a
          random question and plays the spoken reply in this browser.
        </p>
        {personalityLibrary.error ? (
          <p role="status" className="font-sans text-xs text-red-200">{personalityLibrary.error}</p>
        ) : null}
      </div>

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
        {capabilities.usesCustomVoiceDropdown ? (
          <SelectControl<string>
            label="Voice"
            value={activeVoiceValue}
            options={engineVoiceOptions}
            detail={selectedSpeaker?.detail ?? `${engineLabel(engine)} voice`}
            onChange={(value) => void commit(voiceField, value)}
          />
        ) : (
          <SelectControl<VoiceSpeaker>
            label="Voice"
            value={settings.speaker}
            options={voiceOptions as readonly { label: string; value: VoiceSpeaker }[]}
            detail={selectedSpeaker?.detail ?? "Qwen CustomVoice preset"}
            onChange={(speaker) => void commit("speaker", speaker)}
          />
        )}
        <SelectControl<VoiceLanguage>
          label="Language"
          value={settings.language}
          options={VOICE_LANGUAGES}
          detail="Sets pronunciation and text interpretation for generated speech."
          onChange={(language) => void commit("language", language)}
        />
        {/* Accent and Baseline mood are Classic (Qwen) engine controls: they map
            to the Qwen `instruct` string. Engines that clone or synthesize from
            a trained voice have no accent-instruct surface and infer mood from
            the text, so these are hidden unless the active engine uses them. */}
        {capabilities.usesAccentMood && (
          <>
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
          </>
        )}
        <TextAreaControl
          label="Personality description"
          value={settings.personality}
          maxLength={PERSONALITY_MAX_LENGTH}
          placeholder="You are a bright, bubbly helper!"
          detail="Included with the language model's system prompt to shape how the agent behaves and speaks. Clear it to run with the stock prompt."
          onCommit={(personality) => void commit("personality", personality)}
        />
        <PronounsControl
          value={settings.pronouns}
          onCommit={(pronouns) => void commit("pronouns", pronouns)}
        />
        <AffectationsControl
          value={settings.affectations}
          onCommit={(affectations) => void commit("affectations", affectations)}
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
            onPreview={(speechRate) => {
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
            onPreview={(pitch) => {
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
            onPreview={(emotionMirroring) => {
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
            onPreview={(temperature) => {
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
            ariaLabel="Long response probability"
            ariaValueText={`${Math.round(settings.longResponseProbability * 100)} percent`}
            color={[240, 160, 60]}
            intensity={100}
            label="Long responses"
            max={VOICE_SETTINGS_RANGES.longResponseProbability.max}
            min={VOICE_SETTINGS_RANGES.longResponseProbability.min}
            step={VOICE_SETTINGS_RANGES.longResponseProbability.step}
            value={settings.longResponseProbability}
            valueText={settings.longResponseProbability.toFixed(2)}
            onPreview={(longResponseProbability) => {
              draggingRef.current.add("longResponseProbability");
              setSettings((current) => ({ ...current, longResponseProbability }));
            }}
            onCommit={(longResponseProbability) =>
              void commit("longResponseProbability", longResponseProbability)
            }
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Chance a spoken reply runs two to four sentences instead of one; 0.00 keeps every
            reply short.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Command reply minimum words"
            ariaValueText={
              settings.commandReplyMinWords === 0
                ? "no minimum"
                : `at least ${settings.commandReplyMinWords} words`
            }
            color={[240, 160, 60]}
            intensity={100}
            label="Command reply minimum length"
            max={VOICE_SETTINGS_RANGES.commandReplyMinWords.max}
            min={VOICE_SETTINGS_RANGES.commandReplyMinWords.min}
            step={VOICE_SETTINGS_RANGES.commandReplyMinWords.step}
            value={settings.commandReplyMinWords}
            valueText={
              settings.commandReplyMinWords === 0 ? "None" : `≥${settings.commandReplyMinWords}`
            }
            onPreview={(commandReplyMinWords) => {
              draggingRef.current.add("commandReplyMinWords");
              setSettings((current) => ({ ...current, commandReplyMinWords }));
            }}
            onCommit={(commandReplyMinWords) =>
              void commit("commandReplyMinWords", commandReplyMinWords)
            }
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Guarantees every command acknowledgement is at least this many words — raise above 0
            to stop silent completions, which are easy to mistake for no response during
            development. 0 allows the occasional silent confirmation.
          </p>
        </div>

        <div className="grid gap-1.5">
          <SliderControlPanel
            ariaLabel="Command reply maximum words"
            ariaValueText={
              settings.commandReplyMaxWords === 0
                ? "silent"
                : `up to ${settings.commandReplyMaxWords} words`
            }
            color={[240, 160, 60]}
            intensity={100}
            label="Command reply maximum length"
            max={VOICE_SETTINGS_RANGES.commandReplyMaxWords.max}
            min={VOICE_SETTINGS_RANGES.commandReplyMaxWords.min}
            step={VOICE_SETTINGS_RANGES.commandReplyMaxWords.step}
            value={settings.commandReplyMaxWords}
            valueText={
              settings.commandReplyMaxWords === 0
                ? "Silent"
                : `≤${settings.commandReplyMaxWords}`
            }
            onPreview={(commandReplyMaxWords) => {
              draggingRef.current.add("commandReplyMaxWords");
              setSettings((current) => ({ ...current, commandReplyMaxWords }));
            }}
            onCommit={(commandReplyMaxWords) =>
              void commit("commandReplyMaxWords", commandReplyMaxWords)
            }
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Maximum spoken words when confirming a command; the actual length is rolled randomly
            between the minimum above and this each time.
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
            onPreview={(volumeDay) => {
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
            onPreview={(volumeNight) => {
              draggingRef.current.add("volumeNight");
              setSettings((current) => ({ ...current, volumeNight }));
            }}
            onCommit={(volumeNight) => void commit("volumeNight", volumeNight)}
          />
          <p className="px-1 text-xs leading-snug text-neutral-500">
            Playback loudness for spoken responses from 9 pm to 8 am, so overnight replies stay quiet.
          </p>
        </div>

        <TranscriptTemplateControl
          agentName={agentName}
          value={settings.transcriptTemplate}
          onCommit={(transcriptTemplate) => void commit("transcriptTemplate", transcriptTemplate)}
        />
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
