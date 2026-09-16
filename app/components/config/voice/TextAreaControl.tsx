"use client";

import { useEffect, useState } from "react";

export function TextAreaControl({
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
