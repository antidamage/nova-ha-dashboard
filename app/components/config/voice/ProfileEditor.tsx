"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeakerProfileSummary } from "../../../../lib/voice-host-settings";
import { DEFAULT_SPEECH_PREFERENCES } from "./speaker-profiles-model";

export function ProfileEditor({ profile, onSaved, onDeleteProfile }: {
  profile: SpeakerProfileSummary;
  onSaved: () => Promise<void>;
  onDeleteProfile?: (id: string) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pronouns, setPronouns] = useState(profile.pronouns ?? "");
  const initialSpeech = profile.speechPreferences ?? DEFAULT_SPEECH_PREFERENCES;
  const [language, setLanguage] = useState(initialSpeech.language);
  const [speechRate, setSpeechRate] = useState(initialSpeech.speech_rate);
  const [deliveryMode, setDeliveryMode] = useState(initialSpeech.delivery_mode);
  const [accessibilityPacing, setAccessibilityPacing] = useState(
    initialSpeech.accessibility_pacing,
  );
  const [pronunciations, setPronunciations] = useState(
    Object.entries(initialSpeech.pronunciations)
      .map(([source, spoken]) => `${source} = ${spoken}`).join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setPronouns(profile.pronouns ?? "");
    const speech = profile.speechPreferences ?? DEFAULT_SPEECH_PREFERENCES;
    setLanguage(speech.language);
    setSpeechRate(speech.speech_rate);
    setDeliveryMode(speech.delivery_mode);
    setAccessibilityPacing(speech.accessibility_pacing);
    setPronunciations(Object.entries(speech.pronunciations)
      .map(([source, spoken]) => `${source} = ${spoken}`).join("\n"));
  }, [profile]);

  type EditorValues = {
    displayName: string;
    pronouns: string;
    language: string;
    speechRate: number;
    deliveryMode: typeof deliveryMode;
    accessibilityPacing: boolean;
    pronunciations: string;
  };

  const save = (overrides: Partial<EditorValues> = {}) => {
    const values: EditorValues = {
      displayName,
      pronouns,
      language,
      speechRate,
      deliveryMode,
      accessibilityPacing,
      pronunciations,
      ...overrides,
    };
    if (!values.displayName.trim()) return;
    const version = ++saveVersionRef.current;
    setSaving(true);
    setSaveError(null);
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/voice/speaker-profiles/${encodeURIComponent(profile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName.trim(),
          pronouns: values.pronouns.trim(),
          speechPreferences: {
            language: values.language,
            speech_rate: values.speechRate,
            delivery_mode: values.deliveryMode,
            accessibility_pacing: values.accessibilityPacing,
            pronunciations: Object.fromEntries(values.pronunciations.split("\n").flatMap((line) => {
              const separator = line.indexOf("=");
              if (separator < 1) return [];
              const source = line.slice(0, separator).trim();
              const spoken = line.slice(separator + 1).trim();
              return source && spoken ? [[source, spoken]] : [];
            })),
          },
        }),
      });
      if (!response.ok) throw new Error(`Profile update failed: ${response.status}`);
      if (version === saveVersionRef.current) await onSaved();
    }).catch((error) => {
      if (version === saveVersionRef.current) setSaveError(error instanceof Error ? error.message : "Profile update failed");
    }).finally(() => {
      if (version === saveVersionRef.current) setSaving(false);
    });
    return saveQueueRef.current;
  };

  return (
    <div className="grid gap-3 border border-neutral-700 bg-neutral-950/50 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-xs text-neutral-400">
          Name
          <input
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Pronouns
          <input
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={pronouns}
            maxLength={80}
            placeholder="she/her, they/them…"
            onChange={(event) => setPronouns(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </label>
        <span className={`self-end pb-2 text-xs ${saveError ? "text-red-300" : "text-neutral-500"}`} role="status">
          {saveError ?? (saving ? "Saving…" : "Changes save automatically")}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="grid gap-1 text-xs text-neutral-400">
          Spoken language
          <select
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={language}
            onChange={(event) => { const next = event.target.value; setLanguage(next); void save({ language: next }); }}
          >
            {["Auto", "English", "Chinese", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Delivery
          <select
            className="border border-neutral-700 bg-black/40 px-2 py-1.5 text-sm text-neutral-100"
            value={deliveryMode}
            onChange={(event) => { const next = event.target.value as typeof deliveryMode; setDeliveryMode(next); void save({ deliveryMode: next }); }}
          >
            <option value="auto">Auto (quiet at night)</option>
            <option value="normal">Normal</option>
            <option value="whisper">Whisper</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-400">
          Pace: {speechRate}%
          <input
            type="range"
            min={70}
            max={130}
            step={5}
            value={speechRate}
            onChange={(event) => setSpeechRate(Number(event.target.value))}
            onPointerUp={() => void save()}
            onKeyUp={() => void save()}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={accessibilityPacing}
          onChange={(event) => { const next = event.target.checked; setAccessibilityPacing(next); void save({ accessibilityPacing: next }); }}
        />
        Clear accessibility pacing and deliberate word boundaries
      </label>
      <label className="grid gap-1 text-xs text-neutral-400">
        Pronunciation dictionary (one “written = spoken” entry per line)
        <textarea
          className="min-h-20 border border-neutral-700 bg-black/40 px-2 py-1.5 font-mono text-sm text-neutral-100"
          value={pronunciations}
          placeholder="Ngā = Ngar"
          onChange={(event) => setPronunciations(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur();
          }}
        />
      </label>
      <p className="text-xs text-neutral-500">
        {profile.templates.length} associated recorded identit{profile.templates.length === 1 ? "y" : "ies"}
      </p>
      {onDeleteProfile ? (
        <button
          type="button"
          className="justify-self-start text-xs font-semibold text-red-300 hover:text-red-200"
          onClick={() => void onDeleteProfile(profile.id)}
        >
          Delete person and all voice templates
        </button>
      ) : null}
    </div>
  );
}
