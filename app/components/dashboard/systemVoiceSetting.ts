"use client";

import { useEffect, useSyncExternalStore } from "react";

// Client-side mirror of the household voice killswitch (VoicePreferences
// .systemVoiceEnabled, edited by VoiceKillswitch in VoiceInfrastructureConfig).
//
// The killswitch is the master switch for the whole system: when it is off,
// voice host drops every microphone frame. This module makes the dashboard page
// honour it locally as well, so a browser satellite never opens the client
// microphone while voice is switched off system-wide — rather than opening it
// and streaming frames that the server throws away.
//
// Two deliberate properties:
//   - Fail-safe start. Until a read succeeds the answer is "not confirmed on",
//     so the mic stays shut. A confirmed read flips it within one poll.
//   - Sticky after a blip. A failed poll keeps the last known answer instead of
//     dropping a live conversation over one bad fetch.
//
// Polling only runs while at least one component is armed (i.e. this device has
// its own per-device voice input enabled). Devices with web voice off — the
// default — never poll at all.

const POLL_INTERVAL_MS = 30_000;

let known = false;
let enabled = false;
let armedCount = 0;
let pollTimer: number | null = null;
let inFlight = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setEnabled(next: boolean) {
  if (known && enabled === next) return;
  known = true;
  enabled = next;
  emit();
}

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await fetch("/api/voice", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { voice?: { systemVoiceEnabled?: boolean } };
    // Matches normalizeVoiceSettings: anything but an explicit false is on.
    setEnabled(data.voice?.systemVoiceEnabled !== false);
  } catch (error) {
    // Keep the last known answer; a transient failure must not cut a live turn.
    console.error("[nova-dashboard] failed to read the system voice switch", error);
  } finally {
    inFlight = false;
  }
}

function startPolling() {
  if (pollTimer !== null) return;
  void poll();
  pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return known && enabled;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * True only when the household voice killswitch is confirmed ON.
 *
 * Pass `armed` = this device's own web voice input is enabled. Only armed
 * callers start the poll, and an unarmed caller always reads false.
 */
export function useSystemVoiceEnabled(armed: boolean): boolean {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!armed) return;
    armedCount += 1;
    startPolling();
    return () => {
      armedCount -= 1;
      if (armedCount <= 0) {
        armedCount = 0;
        stopPolling();
      }
    };
  }, [armed]);

  return armed && value;
}

/** Test seam: reset the module store between cases. */
export function resetSystemVoiceStateForTests() {
  known = false;
  enabled = false;
  armedCount = 0;
  inFlight = false;
  stopPolling();
  listeners.clear();
}
