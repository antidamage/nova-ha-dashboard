"use client";

import { Check } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { useVoiceLlmSwitch } from "./useVoiceLlmSwitch";

// Language model picker with its confirm step and switch progress.
// See specs/voice-llm-selector.md.
export function VoiceLlmSection() {
  const { reachable, llm, llms, pending, setPending, switchInFlight, requestSwitch, label, note, failed } =
    useVoiceLlmSwitch();

  return (
    <div className="mb-4 grid gap-1.5">
      <p className="text-xs font-black uppercase text-neutral-400">Language model</p>
      {reachable === false ? (
        <p className="px-1 font-sans text-xs leading-snug text-neutral-500">Voice server unavailable.</p>
      ) : (
        <div role="radiogroup" aria-label="Language model" className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {llms.map((option) => {
            const selected = (pending ?? llm) === option.id;
            return (
              <MomentaryFeedbackButton
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={switchInFlight || !option.available}
                className={`cyber-checkbox-row border p-4 text-left ${
                  selected ? "cyber-checkbox-row-active" : ""
                }`}
                onClick={() => setPending(option.id === llm ? null : option.id)}
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
                    {llm === option.id ? " · active" : ""}
                  </span>
                  {option.detail ? <span className="theme-display-detail">{option.detail}</span> : null}
                  {!option.available && option.unavailableReason ? (
                    <span className="theme-display-detail text-amber-200">{option.unavailableReason}</span>
                  ) : null}
                </span>
              </MomentaryFeedbackButton>
            );
          })}
        </div>
      )}
      {pending !== null && pending !== llm && !switchInFlight ? (
        <div className="grid gap-2 px-1">
          <p className="font-sans text-xs leading-snug text-amber-200">
            {label(pending)} loads while the current model keeps answering, then the voice agent moves to
            it and the current model is shut down. Replies continue throughout.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="system-confirm-go" onClick={() => void requestSwitch(pending)}>
              Switch to {label(pending)}
            </button>
            <button type="button" className="system-confirm-cancel" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {note ? (
        <p
          role="status"
          className={`px-1 font-sans text-xs leading-snug ${failed ? "text-red-200" : "text-amber-200"}`}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
