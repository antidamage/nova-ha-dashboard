"use client";

import { useEffect, useState } from "react";

export function TextControl({
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
