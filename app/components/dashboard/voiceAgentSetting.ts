"use client";

import { useCallback, useEffect, useState } from "react";

// Per-device voice-agent preference. Like the experience mode (see
// experienceModeSetting.ts) this is a browser-local setting: it lives in
// localStorage on the device, never travels with a theme, and is never written
// to the shared host config. It controls whether this particular browser
// captures voice input as a web satellite.
//
//   - voiceEnabled : the master switch for this device's WEB voice input. When
//                    off, the browser never opens its microphone and the
//                    always-on option is disabled. It does NOT affect the
//                    dashboard's voice animations/events (orb glow, transcripts,
//                    agent-speech playback) and does NOT affect any separate
//                    native satellite process running on the same machine — a
//                    native PC satellite keeps capturing exactly as before.
//   - alwaysOn     : load with voice mode already on and never idle-disable it.
//                    Only meaningful (and only settable) while voiceEnabled.
//
// Input is always the browser's own microphone (native web capture); there is
// no per-device "custom/native" choice anymore.
//
// Storage is one key holding a small JSON object. Missing/invalid values fall
// back to the defaults below. A fresh device defaults with web voice input OFF,
// so kiosks (e.g. Nocturnium) never open a browser mic until explicitly enabled.

export type VoiceAgentSetting = {
  voiceEnabled: boolean;
  alwaysOn: boolean;
};

export const DEFAULT_VOICE_AGENT_SETTING: VoiceAgentSetting = {
  voiceEnabled: false,
  alwaysOn: false,
};

const VOICE_AGENT_STORAGE_KEY = "nova.dashboard.voiceAgent.v1";
const VOICE_AGENT_CHANGE_EVENT = "nova-voice-agent-change";

export { VOICE_AGENT_STORAGE_KEY };

/** Effective always-on: only true when the master switch is also on. */
export function effectiveAlwaysOn(setting: VoiceAgentSetting): boolean {
  return setting.voiceEnabled && setting.alwaysOn;
}

function parseStored(raw: string | null): VoiceAgentSetting {
  if (raw && raw.charAt(0) === "{") {
    try {
      const parsed = JSON.parse(raw) as Partial<VoiceAgentSetting> & {
        // Legacy field from the pre-master-switch schema; read only for
        // migration so an existing device lands in the right state.
        inputMode?: unknown;
      };
      if (parsed && typeof parsed === "object") {
        const hasNewFlag = typeof parsed.voiceEnabled === "boolean";
        // Migration for settings written before voiceEnabled existed. The old
        // "native" mode opened this browser's mic, so it maps to enabled. The
        // old "custom" mode bound the orb to a separate native satellite and
        // NEVER opened the browser mic — that is exactly the voice-input-off
        // state, so it maps to disabled. This keeps a kiosk that ran in custom
        // mode (e.g. Nocturnium) from suddenly opening a browser mic, with no
        // machine-specific code: the prior mode alone decides.
        const voiceEnabled = hasNewFlag
          ? parsed.voiceEnabled === true
          : parsed.inputMode === "native";
        return {
          voiceEnabled,
          alwaysOn: parsed.alwaysOn === true,
        };
      }
    } catch {
      // Fall through to defaults.
    }
  }
  return { ...DEFAULT_VOICE_AGENT_SETTING };
}

export function readVoiceAgentSetting(): VoiceAgentSetting {
  if (typeof window === "undefined") {
    return { ...DEFAULT_VOICE_AGENT_SETTING };
  }
  try {
    return parseStored(window.localStorage.getItem(VOICE_AGENT_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_VOICE_AGENT_SETTING };
  }
}

export function writeVoiceAgentSetting(setting: VoiceAgentSetting) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(VOICE_AGENT_STORAGE_KEY, JSON.stringify(setting));
  } catch {
    // Storage can be denied in private/restricted contexts; in-page state still updates.
  }
  // Mirror the EFFECTIVE always-on flag onto the document element so the
  // pre-paint bootstrap and CSS can react without waiting for hydration
  // (parallels data-nova-lite / data-nova-no-orb in experienceModeSetting.ts).
  // Always-on only takes effect while the master switch is on.
  document.documentElement.toggleAttribute(
    "data-nova-voice-always-on",
    effectiveAlwaysOn(setting),
  );
  window.dispatchEvent(new CustomEvent(VOICE_AGENT_CHANGE_EVENT));
}

/** Patch one or more fields, preserving the rest. */
export function updateVoiceAgentSetting(patch: Partial<VoiceAgentSetting>) {
  writeVoiceAgentSetting({ ...readVoiceAgentSetting(), ...patch });
}

export function useVoiceAgentSetting() {
  const [setting, setSetting] = useState<VoiceAgentSetting>(DEFAULT_VOICE_AGENT_SETTING);

  useEffect(() => {
    const sync = () => setSetting(readVoiceAgentSetting());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== VOICE_AGENT_STORAGE_KEY) {
        return;
      }
      sync();
    };

    sync();
    window.addEventListener(VOICE_AGENT_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VOICE_AGENT_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((patch: Partial<VoiceAgentSetting>) => {
    updateVoiceAgentSetting(patch);
  }, []);

  return [setting, update] as const;
}
