"use client";

import { Check } from "lucide-react";
import { VOICE_AFFECTATION_GROUPS, type VoiceAffectations } from "../../../../lib/voice-settings";

export function AffectationsControl({
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
