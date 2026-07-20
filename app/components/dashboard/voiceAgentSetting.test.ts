import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_AGENT_SETTING,
  VOICE_AGENT_STORAGE_KEY,
  effectiveAlwaysOn,
  readVoiceAgentSetting,
  updateVoiceAgentSetting,
  writeVoiceAgentSetting,
} from "./voiceAgentSetting";

// Storage contract for the per-device voice-agent setting. Like the experience
// mode, this is a browser-local preference read/written under one localStorage
// key; a tampered/partial value must never yield an out-of-range state.
describe("voice agent setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-nova-voice-always-on");
  });

  it("defaults to voice input off and always-on off", () => {
    expect(readVoiceAgentSetting()).toEqual(DEFAULT_VOICE_AGENT_SETTING);
    expect(DEFAULT_VOICE_AGENT_SETTING.voiceEnabled).toBe(false);
  });

  it("round-trips a full setting", () => {
    writeVoiceAgentSetting({ voiceEnabled: true, alwaysOn: true });
    expect(readVoiceAgentSetting()).toEqual({ voiceEnabled: true, alwaysOn: true });
  });

  it("mirrors the EFFECTIVE always-on onto the document element", () => {
    // Always-on only takes effect while the master switch is on.
    writeVoiceAgentSetting({ voiceEnabled: false, alwaysOn: true });
    expect(document.documentElement.hasAttribute("data-nova-voice-always-on")).toBe(false);
    writeVoiceAgentSetting({ voiceEnabled: true, alwaysOn: true });
    expect(document.documentElement.hasAttribute("data-nova-voice-always-on")).toBe(true);
    writeVoiceAgentSetting({ voiceEnabled: true, alwaysOn: false });
    expect(document.documentElement.hasAttribute("data-nova-voice-always-on")).toBe(false);
  });

  it("effectiveAlwaysOn requires both flags", () => {
    expect(effectiveAlwaysOn({ voiceEnabled: false, alwaysOn: true })).toBe(false);
    expect(effectiveAlwaysOn({ voiceEnabled: true, alwaysOn: false })).toBe(false);
    expect(effectiveAlwaysOn({ voiceEnabled: true, alwaysOn: true })).toBe(true);
  });

  it("patches one field without disturbing the others", () => {
    writeVoiceAgentSetting({ voiceEnabled: true, alwaysOn: true });
    updateVoiceAgentSetting({ alwaysOn: false });
    expect(readVoiceAgentSetting()).toEqual({ voiceEnabled: true, alwaysOn: false });
  });

  it("migrates a legacy native-input device to enabled", () => {
    // The old "native" mode opened this browser's mic → web voice input on.
    window.localStorage.setItem(
      VOICE_AGENT_STORAGE_KEY,
      JSON.stringify({ alwaysOn: true, inputMode: "native", customPathId: "" }),
    );
    expect(readVoiceAgentSetting()).toEqual({ voiceEnabled: true, alwaysOn: true });
  });

  it("migrates a legacy custom-input device (bound to a native satellite) to disabled", () => {
    // The old "custom" mode never opened the browser mic; it maps to the
    // voice-input-off state so a kiosk doesn't suddenly open a browser mic.
    window.localStorage.setItem(
      VOICE_AGENT_STORAGE_KEY,
      JSON.stringify({ alwaysOn: true, inputMode: "custom", customPathId: "nocturnium" }),
    );
    expect(readVoiceAgentSetting()).toEqual({ voiceEnabled: false, alwaysOn: true });
  });

  it("coerces a tampered value back to booleans", () => {
    window.localStorage.setItem(
      VOICE_AGENT_STORAGE_KEY,
      JSON.stringify({ voiceEnabled: "yes", alwaysOn: 42 }),
    );
    expect(readVoiceAgentSetting()).toEqual({ voiceEnabled: false, alwaysOn: false });
  });

  it("falls back to defaults on unparseable storage", () => {
    window.localStorage.setItem(VOICE_AGENT_STORAGE_KEY, "not json");
    expect(readVoiceAgentSetting()).toEqual(DEFAULT_VOICE_AGENT_SETTING);
  });
});
