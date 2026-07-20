"use client";

import { Check } from "lucide-react";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { effectiveAlwaysOn, useVoiceAgentSetting } from "./dashboard/voiceAgentSetting";

// The per-device voice-agent controls that sit at the TOP of the config page's
// "This Device" group:
//   1. Voice Agent master switch — enables this browser's WEB voice input.
//      Turning it off disables the always-on option and stops the browser mic;
//      it does NOT stop the dashboard's voice animations/events, and it does
//      NOT touch any separate native satellite process on the same machine.
//   2. Always-on voice agent (load with voice mode on, never idle-disable);
//      only settable while the master switch is on.
//
// Input is always this browser's own microphone — there is no native/custom
// selection.

function CheckboxRow({
  checked,
  detail,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  detail: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      className={`cyber-checkbox-row border p-4 text-left ${checked ? "cyber-checkbox-row-active" : ""} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
    >
      <span className={`cyber-checkbox ${checked ? "cyber-checkbox-checked" : ""}`} aria-hidden="true">
        {checked && <Check className="h-6 w-6" strokeWidth={3} />}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="theme-display-label zone-title-bar">{label}</span>
        <span className="theme-display-detail">{detail}</span>
      </span>
    </MomentaryFeedbackButton>
  );
}

export function VoiceInputDeviceGroup({ agentName }: { agentName: string }) {
  const [setting, update] = useVoiceAgentSetting();

  return (
    <div className="grid gap-3">
      <CheckboxRow
        checked={setting.voiceEnabled}
        label="Voice Agent"
        detail={
          setting.voiceEnabled
            ? `This device captures voice input for ${agentName}`
            : "Web voice input is off; the orb, animations, and playback still run"
        }
        onChange={(checked) => update({ voiceEnabled: checked })}
      />

      <CheckboxRow
        checked={effectiveAlwaysOn(setting)}
        disabled={!setting.voiceEnabled}
        label="Always-on voice agent"
        detail={
          !setting.voiceEnabled
            ? "Turn on Voice Agent to enable always-on listening"
            : effectiveAlwaysOn(setting)
              ? `This device loads with ${agentName} voice mode on and never times out`
              : "Voice mode starts off; tap the status orb to talk"
        }
        onChange={(checked) => update({ alwaysOn: checked })}
      />
    </div>
  );
}

export default VoiceInputDeviceGroup;
