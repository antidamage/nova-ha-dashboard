"use client";

import { useEffect, useState } from "react";
import {
  PRONOUN_MAX_LENGTH,
  PRONOUN_PATTERN,
  VOICE_PRONOUN_PRESETS,
  type VoicePronouns,
} from "../../../../lib/voice-settings";

export function PronounsControl({
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
