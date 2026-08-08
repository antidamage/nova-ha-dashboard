"use client";

import { useSyncExternalStore } from "react";
import {
  effectiveAlwaysOn,
  readVoiceAgentSetting,
  useVoiceAgentSetting,
} from "./voiceAgentSetting";
import { useSystemVoiceEnabled } from "./systemVoiceSetting";

// Shared client-side voice-mode state for the status orb and the browser
// satellite runtime. This is a single module-level store (not per-component
// state) so the orb visual and the transport runtime — which live in different
// components — always agree on whether a conversation is live.
//
// It owns the "is this device listening / in a live turn" state that drives the
// orb glow and virtual-load pin, and the idle timers. The browser satellite
// runtime drives it via beginConversation()/markInput()/endTurn(); the orb's
// speech-end effect resets the idle timer through markInput().
//
// Behaviour mirrors the native satellite rules:
//   - voice-disabled devices: web voice input is off; tapping does nothing and
//     no idle turns run. Agent-speech animations/events still play.
//   - system voice killswitch off: the same as voice-disabled, on every device.
//     The household master switch wins over the per-device one, so no browser
//     opens its microphone while voice is switched off system-wide.
//   - alwaysOn devices (master switch on): voice mode is on from load and never
//     idle-disables.
//   - enabled, non-alwaysOn devices: tapping the orb opens a turn; after
//     NO_INPUT_TIMEOUT_MS with no transcribable input the turn closes itself.
//   - any idle timer resets at the END of agent speech and restarts.

const NO_INPUT_TIMEOUT_MS = 10000;

type VoiceModeStore = {
  active: boolean;
  conversationActive: boolean;
};

let store: VoiceModeStore = { active: false, conversationActive: false };
const listeners = new Set<() => void>();
let idleTimer: number | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setStore(next: Partial<VoiceModeStore>) {
  const merged = { ...store, ...next };
  if (merged.active === store.active && merged.conversationActive === store.conversationActive) {
    return;
  }
  store = merged;
  emit();
}

function clearIdle() {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** (Re)arm the no-input idle timer for a tap-to-talk turn; never for always-on. */
function armIdle() {
  clearIdle();
  if (effectiveAlwaysOn(readVoiceAgentSetting())) return;
  idleTimer = window.setTimeout(endTurn, NO_INPUT_TIMEOUT_MS);
}

/** True only in a secure context where getUserMedia is allowed. */
export function isSecureVoiceContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true || window.location.hostname === "localhost";
}

/** Open a conversation/turn on this device (glow + load pin on). */
export function beginConversation() {
  clearIdle();
  setStore({ active: true, conversationActive: true });
  armIdle();
}

/** Transcribable input arrived: keep the conversation open and reset the idle timer. */
export function markInput() {
  setStore({ conversationActive: true });
  armIdle();
}

/** End the current turn/conversation; always-on devices stay in voice mode. */
export function endTurn() {
  clearIdle();
  const stayActive = effectiveAlwaysOn(readVoiceAgentSetting());
  setStore({ active: stayActive, conversationActive: false });
}

/**
 * Force voice mode fully off, ignoring always-on. Used when the device stops
 * being eligible at all (per-device switch or household killswitch off), where
 * endTurn's "always-on devices stay listening" rule must not apply.
 */
export function deactivateVoice() {
  clearIdle();
  setStore({ active: false, conversationActive: false });
}

/** Ensure always-on devices load with voice mode on (called by the setting hook). */
export function ensureAlwaysOn(active: boolean) {
  if (active && !store.active) {
    setStore({ active: true });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VoiceModeStore {
  return store;
}

const SERVER_SNAPSHOT: VoiceModeStore = { active: false, conversationActive: false };

export type VoiceModeState = {
  /** This device can act as a browser voice satellite (voice enabled + secure). */
  eligible: boolean;
  /** Voice mode is on (always-on, or turned on by a tap). */
  active: boolean;
  /** A live conversation/turn is in progress → orb glows + load pins to 100. */
  conversationActive: boolean;
  /** Tapping the orb is meaningful on this device (voice enabled, not always-on). */
  tappable: boolean;
  /** Toggle a push-to-talk turn (no-op on voice-disabled / always-on devices). */
  toggleTap: () => void;
  /** Called by the satellite runtime when transcribable input arrives (resets idle). */
  markInput: () => void;
  /** Called by the satellite runtime / wake path to open a conversation. */
  beginConversation: () => void;
  /** Called to end the current turn/conversation. */
  endTurn: () => void;
};

export function useVoiceMode(): VoiceModeState {
  const [setting] = useVoiceAgentSetting();
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  // The household killswitch is polled only while this device's own web voice
  // input is on, and gates the mic on top of it.
  const systemVoiceOn = useSystemVoiceEnabled(setting.voiceEnabled);

  const eligible = isSecureVoiceContext() && setting.voiceEnabled && systemVoiceOn;
  // Voice-disabled devices never open the mic, so tapping does nothing.
  // Always-on devices are already listening, so there is no manual toggle
  // either.
  const tappable = eligible && !effectiveAlwaysOn(setting);

  const toggleTap = () => {
    if (!tappable) return;
    if (state.active) {
      endTurn();
    } else {
      beginConversation();
    }
  };

  return {
    eligible,
    active: state.active,
    conversationActive: state.conversationActive,
    tappable,
    toggleTap,
    markInput,
    beginConversation,
    endTurn,
  };
}
