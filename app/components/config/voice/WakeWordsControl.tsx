"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { WAKE_WORD_PATTERN, WAKE_WORDS_MAX } from "../../../../lib/voice-settings";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";

export function WakeWordsControl({
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
